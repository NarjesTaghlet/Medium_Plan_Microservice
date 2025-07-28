data "aws_vpcs" "current_site_vpcs" {
  filter {
    name   = "tag:SiteName"
    values = [var.site_name]
  }
  filter {
    name   = "tag:UserId"
    values = [var.user_id]
  }
}

data "aws_vpc" "current_site_vpc" {
  count = length(data.aws_vpcs.current_site_vpcs.ids) > 0 ? 1 : 0
  id    = data.aws_vpcs.current_site_vpcs.ids[0]
}

data "aws_vpcs" "user_vpcs" {
  filter {
    name   = "tag:UserId"
    values = [var.user_id]
  }
}

# Fetch existing subnets with specific tags
data "aws_subnets" "current_site_subnets" {
  filter {
    name   = "tag:SiteName"
    values = [var.site_name]
  }
  filter {
    name   = "tag:UserId"
    values = [var.user_id]
  }
}

data "aws_vpc" "existing_vpcs" {
  for_each = toset(data.aws_vpcs.user_vpcs.ids)
  id       = each.value
}

# Fetch the latest ECS-optimized Amazon Linux 2 AMI
data "aws_ssm_parameter" "ecs_optimized_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id"
}

locals {
  # List of all candidate CIDRs (use /20 for larger address space)
  available_cidrs = ["10.0.0.0/20", "10.0.16.0/20", "10.0.32.0/20"]

  # Check if current site VPC exists
  current_vpc_id   = length(data.aws_vpc.current_site_vpc) > 0 ? data.aws_vpc.current_site_vpc[0].id : null
  current_vpc_cidr = length(data.aws_vpc.current_site_vpc) > 0 ? data.aws_vpc.current_site_vpc[0].cidr_block : null

  # All other VPCs CIDRs (excluding the current one if exists)
  other_vpcs_cidrs = [
    for vpc in data.aws_vpc.existing_vpcs : vpc.cidr_block
    if local.current_vpc_id == null || vpc.id != local.current_vpc_id
  ]

  # Filter available CIDRs
  available_cidr_list = [
    for cidr in local.available_cidrs : cidr
    if !contains(local.other_vpcs_cidrs, cidr)
  ]

  # Final CIDR decision
  vpc_cidr = local.current_vpc_cidr != null ? local.current_vpc_cidr : length(local.available_cidr_list) > 0 ? local.available_cidr_list[0] : error("No available CIDRs")

  vpc_exists = local.current_vpc_id != null
  vpc_id     = local.vpc_exists ? local.current_vpc_id : aws_vpc.site_vpc[0].id

  public_subnet_cidr_1 = cidrsubnet(local.vpc_cidr, 4, 0) # e.g., 10.0.0.0/24
  public_subnet_cidr_2 = cidrsubnet(local.vpc_cidr, 4, 1) # e.g., 10.0.1.0/24
  private_subnet_cidr  = cidrsubnet(local.vpc_cidr, 4, 2) # e.g., 10.0.2.0/24
  private_subnet_cidr_2 = cidrsubnet(local.vpc_cidr, 4, 3) # e.g., 10.0.3.0/24 for RDS

  unique_prefix = "${var.user_id}-${var.site_name}"

  sanitized_site_name = lower(replace(replace(var.site_name, "[^a-zA-Z0-9-]", "-"), "--", "-"))
}

# Validate that a CIDR is available if creating a new VPC
resource "null_resource" "cidr_validation" {
  count = length(data.aws_vpc.current_site_vpc) > 0 ? 0 : (length(local.available_cidr_list) > 0 ? 0 : 1)

  provisioner "local-exec" {
    command = "echo 'Error: No available CIDRs left in the list. All CIDRs (${join(", ", local.available_cidrs)}) are in use by other VPCs: ${join(", ", local.other_vpcs_cidrs)}'; exit 1"
  }
}

# VPC for the Site (only create if it doesn't exist)
resource "aws_vpc" "site_vpc" {
  count               = length(data.aws_vpc.current_site_vpc) > 0 ? 0 : 1
  cidr_block          = local.vpc_cidr
  enable_dns_support  = true
  enable_dns_hostnames = true
  
  tags = {
    Name   = "vpc-${var.site_name}"
    UserId = var.user_id
  }
 lifecycle {
    create_before_destroy = true
  }
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = local.vpc_id
  tags   = { Name = "igw-${var.site_name}" }

  timeouts {
    delete = "15m"  # Increased timeout to handle slow detachment
  }
  
  depends_on = [aws_eip.nat_eip ,aws_subnet.public_subnet_1, aws_subnet.public_subnet_2,aws_vpc.site_vpc]
}

# Null Resource to Force EIP Release
resource "null_resource" "eip_cleanup" {
  triggers = {
    eip_id = aws_eip.nat_eip.id
    region = var.aws_region
  }
  provisioner "local-exec" {
    when    = destroy
    command = <<EOT
      echo "Checking if EIP ${self.triggers.eip_id} is still allocated..."
      if aws ec2 describe-addresses --allocation-ids ${self.triggers.eip_id} --region ${self.triggers.region} 2>/dev/null; then
        echo "Releasing EIP ${self.triggers.eip_id}..."
        aws ec2 release-address --allocation-id ${self.triggers.eip_id} --region ${self.triggers.region}
      else
        echo "EIP ${self.triggers.eip_id} already released."
      fi
    EOT
  }
  depends_on = [aws_nat_gateway.nat]
}

# Public Subnet 1 (for ALB and NAT Gateway in us-east-1a)
resource "aws_subnet" "public_subnet_1" {
  vpc_id                  = local.vpc_id
  cidr_block              = local.public_subnet_cidr_1
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags                    = { Name = "public-subnet-1-${var.site_name}" }
  depends_on              = [aws_vpc.site_vpc]
}

# Public Subnet 2 (for ALB in us-east-1b)
resource "aws_subnet" "public_subnet_2" {
  vpc_id                  = local.vpc_id
  cidr_block              = local.public_subnet_cidr_2
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
  tags                    = { Name = "public-subnet-2-${var.site_name}" }
  depends_on              = [aws_vpc.site_vpc]
}

# Private Subnet (for ECS, RDS, EFS in us-east-1a only)
resource "aws_subnet" "private_subnet" {
  vpc_id            = local.vpc_id
  cidr_block        = local.private_subnet_cidr
  availability_zone = "us-east-1a"
  tags              = { Name = "private-subnet-${var.site_name}" }
  depends_on        = [aws_vpc.site_vpc]
}

resource "aws_subnet" "private_subnet2" {
  vpc_id            = local.vpc_id
  cidr_block        = local.private_subnet_cidr_2
  availability_zone = "us-east-1b"
  tags              = { Name = "private-subnet-${var.site_name}" }
  depends_on        = [aws_vpc.site_vpc]
}

# Elastic IP for NAT Gateway
resource "aws_eip" "nat_eip" {
  domain = "vpc"
  tags   = { Name = "nat-eip-${var.site_name}" }

  lifecycle {
    create_before_destroy = true
  }
  depends_on = [aws_subnet.public_subnet_1]
}

# NAT Gateway in Public Subnet 1 (us-east-1a)
resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.public_subnet_1.id
  tags          = { Name = "nat-${var.site_name}" }

  lifecycle {
    create_before_destroy = true
  }
  depends_on    = [aws_internet_gateway.igw,aws_eip.nat_eip, aws_subnet.public_subnet_1]
}

# Route Table for Public Subnets
resource "aws_route_table" "public" {
  vpc_id = local.vpc_id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = { Name = "public-rt-${var.site_name}" }
}

resource "aws_route_table_association" "public_subnet_1" {
  subnet_id      = aws_subnet.public_subnet_1.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_subnet_2" {
  subnet_id      = aws_subnet.public_subnet_2.id
  route_table_id = aws_route_table.public.id
}

# Route Table for Private Subnet
resource "aws_route_table" "private" {
  vpc_id = local.vpc_id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }
  tags = { Name = "private-rt-${var.site_name}" }
}

resource "aws_route_table_association" "private_subnet" {
  subnet_id      = aws_subnet.private_subnet.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_subnet2" {
  subnet_id      = aws_subnet.private_subnet2.id
  route_table_id = aws_route_table.private.id
}

# S3 VPC Endpoint (Gateway Endpoint)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.us-east-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = { Name = "s3-vpc-endpoint-${var.site_name}" }
}

# Security Group for VPC Endpoints (CloudWatch Logs and Monitoring)
resource "aws_security_group" "vpc_endpoint_sg" {
  vpc_id = local.vpc_id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    security_groups = [aws_security_group.ecs_rds_sg.id] # Allow traffic from ECS
  }

   ingress {
    from_port         = 80
    to_port             = 80
    protocol           = "tcp"
    security_groups = [aws_security_group.ecs_rds_sg.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "vpc-endpoint-sg-${var.site_name}" }
}

# VPC Endpoint for CloudWatch Logs
resource "aws_vpc_endpoint" "cloudwatch_logs" {
  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.us-east-1.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_subnet.id] # Deploy in private subnet
  security_group_ids  = [aws_security_group.vpc_endpoint_sg.id]
  private_dns_enabled = true
  tags = { Name = "cloudwatch-logs-vpc-endpoint-${var.site_name}" }
}

# VPC Endpoint for CloudWatch Monitoring
resource "aws_vpc_endpoint" "cloudwatch_monitoring" {
  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.us-east-1.monitoring"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private_subnet.id] # Deploy in private subnet
  security_group_ids  = [aws_security_group.vpc_endpoint_sg.id]
  private_dns_enabled = true
  tags = { Name = "cloudwatch-monitoring-vpc-endpoint-${var.site_name}" }
}

# Security Group for ALB
resource "aws_security_group" "alb_sg" {
  vpc_id = local.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "alb-sg-${var.site_name}" }
}

# Security Group for ECS, RDS, and EFS
resource "aws_security_group" "ecs_rds_sg" {
  vpc_id = local.vpc_id
  ingress {
    from_port       = 3003
    to_port         = 3003
    protocol        = "tcp"
  }

 ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }
  
  ingress {
    from_port   = 3306
    to_port     = 3306
    protocol    = "tcp"
    self        = true
  }
  ingress {
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    self        = true
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "ecs-rds-sg-${var.site_name}" }
}

# Application Load Balancer (ALB) - Using two AZs
resource "aws_lb" "alb" {
  name               = "alb-${var.site_name}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]
  tags               = { Name = "alb-${var.site_name}" }

  depends_on         = [aws_subnet.public_subnet_1, aws_subnet.public_subnet_2, aws_internet_gateway.igw]
  timeouts {
    delete = "10m"
  }
}

resource "aws_lb_target_group" "medium_tier_tg" {
  name        = "mt-tg-${var.site_name}"
   port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id
  health_check {
    enabled  = true
    path     = "/"
    interval = 60
    matcher  = "200"
  }
  tags = { Name = "medium-tier-tg-${var.site_name}" }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.alb.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.medium_tier_tg.arn
  }
}

# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecs-task-execution-role-${var.site_name}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
  tags = { Name = "ecs-task-execution-role-${var.site_name}" }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Add S3 Access to ECS Task Execution Role (if needed for pulling images)
resource "aws_iam_role_policy" "ecs_task_s3_access" {
  name   = "ecs-task-s3-access-${var.site_name}"
  role   = aws_iam_role.ecs_task_execution_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:s3:::*"
        ]
      }
    ]
  })
}

# 1. Créez une politique IAM explicite
resource "aws_iam_policy" "ecs_secrets_access" {
  name = "ecs-secrets-access-${var.site_name}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Effect   = "Allow"
        Resource = aws_secretsmanager_secret.site_secrets.arn
      }
    ]
  })
}

# 2. Attachez-la au rôle ECS
resource "aws_iam_role_policy_attachment" "ecs_secrets" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.ecs_secrets_access.arn
}


# Add CloudWatch Access to ECS Task Execution Role
resource "aws_iam_role_policy" "ecs_task_cloudwatch_access" {
  name   = "ecs-task-cloudwatch-access-${var.site_name}"
  role   = aws_iam_role.ecs_task_execution_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "${aws_cloudwatch_log_group.medium_tier.arn}:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "secretsmanager:DescribeSecret"
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricData"]
        Resource = "*"
      }
    ]
  })
}

# IAM Role for EC2 Instances
resource "aws_iam_role" "ecs_instance_role" {
  name = "ecs-instance-role-${var.site_name}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
  tags = { Name = "ecs-instance-role-${var.site_name}" }
}

resource "aws_iam_role_policy_attachment" "ecs_instance_policy" {
  role       = aws_iam_role.ecs_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "ecs_instance_profile" {
  name = "ecs-instance-profile-${var.site_name}"
  role = aws_iam_role.ecs_instance_role.name
}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "ecs-cluster-${var.site_name}"
  tags = { Name = "ecs-cluster-${var.site_name}" }
}

# Capacity Provider for ECS
resource "aws_ecs_capacity_provider" "ecs_capacity_provider" {
  name = "capacity-${var.site_name}"

  auto_scaling_group_provider {
    auto_scaling_group_arn = aws_autoscaling_group.ecs_asg.arn

    managed_scaling {
      maximum_scaling_step_size = 2
      minimum_scaling_step_size = 1
      status                    = "ENABLED"
      target_capacity           = 1
    }
  }

   lifecycle {
    create_before_destroy = true
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = [aws_ecs_capacity_provider.ecs_capacity_provider.name]

  default_capacity_provider_strategy {
    base              = 100
    weight            = 100
    capacity_provider = aws_ecs_capacity_provider.ecs_capacity_provider.name
  }
}

# EC2 Launch Template for ECS - Using dynamic AMI
resource "aws_launch_template" "ecs_ec2" {
  name_prefix   = "ecs-ec2-${var.site_name}-"
  image_id      = data.aws_ssm_parameter.ecs_optimized_ami.value
  instance_type = "t3.medium"

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance_profile.name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.ecs_rds_sg.id]
  }

  user_data = base64encode(<<EOF
#!/bin/bash
echo ECS_CLUSTER=${aws_ecs_cluster.main.name} >> /etc/ecs/ecs.config
EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "ecs-instance-${var.site_name}" }
  }
}

# Auto Scaling Group for EC2 Instances - Single AZ
resource "aws_autoscaling_group" "ecs_asg" {
  name = "asg-${var.site_name}"
  desired_capacity    = 1
  min_size            = 1
  max_size            = 2
  vpc_zone_identifier = [aws_subnet.private_subnet.id]
  force_delete          = true

  launch_template {
    id      = aws_launch_template.ecs_ec2.id
    version = "$Latest"
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = true
    propagate_at_launch = true
  }

  tag {
    key                 = "Name"
    value               = "ecs-asg-${var.site_name}"
    propagate_at_launch = true
  }

  termination_policies = ["OldestInstance"] # Terminate oldest instances first
  timeouts {
    delete = "15m"
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes = [desired_capacity] # Let ECS handle this dynamically
  }
}

# CloudWatch Log Group for ECS
resource "aws_cloudwatch_log_group" "medium_tier" {
  name              = "/ecs/medium-tier-${var.site_name}"
  retention_in_days = 30
  tags              = { Name = "medium-tier-logs-${var.site_name}" }
}

# Random Password for RDS
resource "random_password" "db_password" {
  length           = 16
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# RDS Subnet Group - Single AZ
resource "aws_db_subnet_group" "main" {
  name       = "rds-subnet-${local.sanitized_site_name}"
 subnet_ids = [
    aws_subnet.private_subnet.id,
    aws_subnet.private_subnet2.id
  ]
  tags       = { Name = "rds-subnet-group-${var.site_name}" }
}

# RDS Instance (MySQL) for Drupal - Single AZ with automated backups
resource "aws_db_instance" "mysql" {
  identifier = substr(
    replace("db-${var.user_id}-${var.site_name}", "/[^a-zA-Z0-9-]/", "-"),
    0, 63
  )
  engine               = "mysql"
  multi_az                   = false
  engine_version       = "8.0"
  availability_zone = "us-east-1a"
  instance_class       = "db.t3.micro"
  allocated_storage    = 20
  username             = "user"
  password             = random_password.db_password.result
  db_name = substr(
    replace("db${var.user_id}${var.site_name}", "/[^a-zA-Z0-9_]/", "_"),
    0, 64
  )
  vpc_security_group_ids = [aws_security_group.ecs_rds_sg.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  publicly_accessible    = false
  skip_final_snapshot    = true
  parameter_group_name = aws_db_parameter_group.drupal-mysql.name

  # Enable automated backups with daily snapshots
  backup_retention_period = 7  # Keep backups for 7 days
  backup_window           = "03:00-04:00"  # Daily backup window (UTC)
  maintenance_window      = "sun:05:00-sun:06:00"  # Maintenance window
  
  # Enable enhanced monitoring
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  tags = {
    UserID    = var.user_id
    SiteName  = var.site_name
    DeployedAt = timestamp()
  }

 depends_on = [aws_db_subnet_group.main, aws_security_group.ecs_rds_sg]
}





# IAM Role for RDS Enhanced Monitoring
resource "aws_iam_role" "rds_monitoring" {
  name = "rds-monitoring-role-${var.site_name}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Custom Parameter Group for MySQL - Removed invalid parameters
resource "aws_db_parameter_group" "drupal-mysql" {
  name   = "mysql-${local.sanitized_site_name}"
  family = "mysql8.0"

  parameter {
    name  = "character_set_server"
    value = "utf8mb4"
  }
  parameter {
    name  = "collation_server"
    value = "utf8mb4_unicode_ci"
  }
  parameter {
    name  = "innodb_buffer_pool_size"
    value = "1073741824"  # 1 GB
  }
  parameter {
    name  = "skip_name_resolve"
    value = "1"
    apply_method = "pending-reboot" 
  }
  tags = { Name = "drupal-mysql-params-${var.site_name}" }
}

# EFS File System
resource "aws_efs_file_system" "efs" {
  creation_token = "efs-${var.site_name}"
  tags           = { Name = "efs-${var.site_name}" }
}

resource "aws_efs_access_point" "efs_access_point_files" {
  file_system_id = aws_efs_file_system.efs.id
 posix_user {
    uid = 33  # www-data UID
    gid = 33  # www-data GID
  }
  root_directory {
    path = "/drupal/files"
    creation_info {
      owner_uid   = 33
      owner_gid   = 33
      permissions = "0755"
    }
  }
  tags = { Name = "efs-access-point-files-${var.site_name}" }
}

# EFS Mount Target - Single AZ
resource "aws_efs_mount_target" "efs_mount" {
  file_system_id  = aws_efs_file_system.efs.id
  subnet_id       = aws_subnet.private_subnet.id
  security_groups = [aws_security_group.ecs_rds_sg.id]
}

# IAM Role for ECS Task (not execution role)
resource "aws_iam_role" "ecs_task_role" {
  name = "ecs-task-role-${var.site_name}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
  tags = { Name = "ecs-task-role-${var.site_name}" }
}

# IAM Policy for EFS Access
resource "aws_iam_policy" "ecs_task_efs_access" {
  name = "ecs-task-efs-access-${var.site_name}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRead"
        ]
        Resource = aws_efs_file_system.efs.arn
      }
    ]
  })
}

# Attach EFS Policy to Task Role
resource "aws_iam_role_policy_attachment" "ecs_task_efs_policy" {
  role       = aws_iam_role.ecs_task_role.name
  policy_arn = aws_iam_policy.ecs_task_efs_access.arn
}

resource "aws_ecs_task_definition" "medium_tier" {
  family                   = "medium-tier-${var.site_name}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn # Add task role
 cpu                      = 2048 # 2 vCPUs (2048 CPU units)
  memory                   = 2048 # 2 GiB (2048 MiB)

  container_definitions = jsonencode([{
    name      = "medium-tier"
    image     = var.docker_image
   // command = ["sleep", "3600"]
    essential = true
    portMappings = [{
      containerPort = 80
      hostPort      = 80
      protocol      = "tcp"
    }]
    environment = [
      {
        "name"  = "DB_HOST"
      //  "value" = aws_db_instance.mysql.endpoint
       "value" = split(":", aws_db_instance.mysql.endpoint)[0]
      },
      {
         "name"  = "DB_NAME"
        "value" = aws_db_instance.mysql.db_name
       // "valueFrom" = "${aws_secretsmanager_secret.db_credentials.arn}:host::" , 
      },
      {
        "name"  = "DB_USER"
        "value"= aws_db_instance.mysql.username
      },
      {
        "name"  = "DB_PASSWORD"
        "value" = random_password.db_password.result
      },
 
      {
         "name"  = "DB_PORT"
        "value"= "3306"
      }
    ]
 /*   container_definitions = jsonencode([{
  name      = "medium-tier"
  image     = var.docker_image
  essential = true
  portMappings = [{
    containerPort = 80
    hostPort      = 80
    protocol      = "tcp"
  }]
  
  # SECTION ENVIRONMENT (variables non sensibles)
  environment = [
    {
      name  = "DB_PORT"
      value = "3306"
    }
  ],
  
  # SECTION SECRETS (variables sensibles)
  secrets = [
    {
      name      = "DB_HOST"
      valueFrom = "${aws_secretsmanager_secret.site_secrets.arn}:db_endpoint::"
    },
    {
      name      = "DB_NAME"
      valueFrom = "${aws_secretsmanager_secret.site_secrets.arn}:db_name::"
    },
    {
      name      = "DB_USER"
      valueFrom = "${aws_secretsmanager_secret.site_secrets.arn}:db_username::"
    },
    {
      name      = "DB_PASSWORD"
      valueFrom = "${aws_secretsmanager_secret.site_secrets.arn}:db_password::"
    }
  ],*/
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.medium_tier.name
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "medium-tier"
      }
    }
    cpu                      = 2048 # 2 vCPUs (2048 CPU units)
    memory                   = 2048 # 2 GiB (2048 MiB)
    mountPoints = [
      {
        sourceVolume  = "efs-volume-files"
        containerPath = "/var/www/html/web/sites/default/files"
        readOnly      = false
      }
    ]
  }]
  
  )

  volume {
    name = "efs-volume-files"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.efs.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.efs_access_point_files.id
        iam             = "ENABLED"
      }
    }
  }

  tags = { Name = "ecs-task-def-${var.site_name}" }
 depends_on = [
    aws_db_instance.mysql,
    aws_efs_file_system.efs,
    aws_efs_access_point.efs_access_point_files,
    aws_iam_role.ecs_task_execution_role,
    aws_iam_role.ecs_task_role,
    aws_cloudwatch_log_group.medium_tier,
  ]

}

# ECS Service - Single AZ
resource "aws_ecs_service" "medium_tier" {

  name            = "medium-tier-service-${var.site_name}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.medium_tier.arn
  desired_count   = 1

deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds = 60
  timeouts {
    create = "30m"
    update = "30m"
        delete = "30m"  # Increase timeout to 30 minutes

  }

  network_configuration {
    subnets          = [aws_subnet.private_subnet.id]
    security_groups  = [aws_security_group.ecs_rds_sg.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.medium_tier_tg.arn
    container_name   = "medium-tier"
    container_port   = 80
  }



  placement_constraints {
    type = "distinctInstance"
  }

  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ecs_capacity_provider.name
    weight            = 100
  }



  # Stratégie de déploiement blue/green
  deployment_controller {
    type = "ECS"  # Ou "ECS" pour rolling update
  }

  wait_for_steady_state = true
  enable_execute_command  = false
  force_new_deployment  = true

  depends_on = [aws_lb_listener.http, aws_autoscaling_group.ecs_asg, aws_lb.alb, aws_lb_target_group.medium_tier_tg]
  lifecycle {
    create_before_destroy = true
    ignore_changes = [capacity_provider_strategy]
  }
  force_delete = true

  tags = { Name = "ecs-service-medium-tier-${var.site_name}" }
}

/*resource "null_resource" "ecs_service_cleanup" {
  triggers = {
    cluster_name     = aws_ecs_cluster.main.name
    service_name     = aws_ecs_service.medium_tier.name
    target_group_arn = aws_lb_target_group.medium_tier_tg.arn
    region           = var.aws_region
    vpc_id           = local.vpc_id
  }
  provisioner "local-exec" {
    when    = destroy
    command = <<EOT

     # Use assumed credentials
      if ! aws sts get-caller-identity --region ${self.triggers.region} >/dev/null 2>&1; then
        echo "Error: AWS credentials expired or invalid. Please refresh credentials."
        exit 1
      fi
      echo "Stopping all tasks in ECS service..."
      TASKS=$(aws ecs list-tasks --cluster ${self.triggers.cluster_name} --service-name ${self.triggers.service_name} --region ${self.triggers.region} --query 'taskArns' --output text 2>/dev/null)
      if [ ! -z "$TASKS" ]; then
        for TASK in $TASKS; do
          aws ecs stop-task --cluster ${self.triggers.cluster_name} --task $TASK --reason "Force stop for cleanup" --region ${self.triggers.region} || true
        done
        echo "Waiting for tasks to stop (up to 5 minutes)..."
        for i in {1..30}; do
          RUNNING=$(aws ecs list-tasks --cluster ${self.triggers.cluster_name} --service-name ${self.triggers.service_name} --region ${self.triggers.region} --query 'taskArns' --output text)
          if [ -z "$RUNNING" ]; then
            echo "All tasks stopped."
            break
          fi
          sleep 10
        done
      else
        echo "No tasks to stop."
      fi
      echo "Setting ECS service desired count to 0..."
      aws ecs update-service --cluster ${self.triggers.cluster_name} --service ${self.triggers.service_name} --desired-count 0 --region ${self.triggers.region} || true
      echo "Waiting for service to stabilize (60 seconds)..."
      sleep 60
      echo "Deregistering targets from target group ${self.triggers.target_group_arn}..."
      TARGETS=$(aws elbv2 describe-target-health --target-group-arn ${self.triggers.target_group_arn} --region ${self.triggers.region} --query 'TargetHealthDescriptions[].Target.Id' --output text 2>/dev/null)
      if [ ! -z "$TARGETS" ]; then
        for TARGET in $TARGETS; do
          aws elbv2 deregister-targets --target-group-arn ${self.triggers.target_group_arn} --targets Id=$TARGET --region ${self.triggers.region} || true
        done
        echo "Waiting for targets to deregister (up to 5 minutes)..."
        for i in {1..30}; do
          TARGETS=$(aws elbv2 describe-target-health --target-group-arn ${self.triggers.target_group_arn} --region ${self.triggers.region} --query 'TargetHealthDescriptions[].Target.Id' --output text 2>/dev/null)
          if [ -z "$TARGETS" ]; then
            echo "All targets deregistered."
            break
          fi
          sleep 10
        done
      else
        echo "No targets to deregister."
      fi
      echo "Forcing ECS service deletion..."
      aws ecs delete-service --cluster ${self.triggers.cluster_name} --service ${self.triggers.service_name} --force --region ${self.triggers.region} || true
      echo "Cleaning up lingering ENIs..."
      ENIS=$(aws ec2 describe-network-interfaces --filters Name=vpc-id,Values=${self.triggers.vpc_id} Name=description,Values=*ECS* --region ${self.triggers.region} --query 'NetworkInterfaces[].NetworkInterfaceId' --output text 2>/dev/null)
      if [ ! -z "$ENIS" ]; then
        for ENI in $ENIS; do
          aws ec2 delete-network-interface --network-interface-id $ENI --region ${self.triggers.region} || true
        done
        echo "Waiting for ENIs to delete (60 seconds)..."
        sleep 60
      else
        echo "No ENIs to delete."
      fi
      echo "Ensuring cluster is empty before deletion..."
      SERVICES=$(aws ecs list-services --cluster ${self.triggers.cluster_name} --region ${self.triggers.region} --query 'serviceArns' --output text 2>/dev/null)
      if [ ! -z "$SERVICES" ]; then
        for SERVICE in $SERVICES; do
          aws ecs delete-service --cluster ${self.triggers.cluster_name} --service $SERVICE --force --region ${self.triggers.region} || true
        done
        echo "Waiting for services to delete (60 seconds)..."
        sleep 60
      else
        echo "No services to delete."
      fi
    EOT
  }
  depends_on = [aws_lb_target_group.medium_tier_tg, aws_lb.alb, aws_autoscaling_group.ecs_asg]
}*/

# Auto Scaling for ECS Service
resource "aws_appautoscaling_target" "medium_tier_scaling_target" {
  max_capacity       = 2
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.medium_tier.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "medium_tier_scaling_policy" {
  name               = "medium-tier-scaling-policy-${var.site_name}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.medium_tier_scaling_target.resource_id
  scalable_dimension = aws_appautoscaling_target.medium_tier_scaling_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.medium_tier_scaling_target.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 75
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 300
    scale_out_cooldown = 300
  }
}

# CodeBuild Module
# Generate a random string for the webhook secret
resource "random_string" "webhook_secret" {
  length  = 32
  special = false
}

module "codebuild" {
  source         = "./modules/codebuild"
  project_name        = "drupal-deployment-${var.user_id}-${var.site_name}"
  user_id        = var.user_id
  site_name      = var.site_name
  target_ip      = aws_lb.alb.dns_name
    ssh_user            = "ec2-user"
  github_repo    = var.github_repo_url
  buildspec_path = "buildspec.yml"
  docker_image   = var.docker_image
  db_port        = "3306"
  aws_region     = var.aws_region
  github_branch  = "main"
  enable_webhook      = true
  webhook_secret      = random_string.webhook_secret.result
  vpc_id         = local.vpc_id
  private_subnets= [aws_subnet.private_subnet.id, aws_subnet.private_subnet2.id]
  ecs_service_name = aws_ecs_service.medium_tier.name
  ecs_cluster_name = aws_ecs_cluster.main.name
  
  depends_on = [ local.vpc_id ]
}

# Secrets Manager for site credentials
resource "aws_secretsmanager_secret" "site_secrets" {
  name = "sites/${var.user_id}/${var.site_name}"
  tags = {
    UserID    = var.user_id
    SiteName  = var.site_name
    AccountID = var.account_id
  }
}

resource "aws_secretsmanager_secret_version" "site_secrets_version" {
  secret_id = aws_secretsmanager_secret.site_secrets.id
  secret_string = jsonencode({
    instance_name = aws_ecs_cluster.main.name
    alb_dns_name    = aws_lb.alb.dns_name
    db_endpoint   = aws_db_instance.mysql.endpoint
    db_username   = "user"
    db_password   = random_password.db_password.result
    db_name = "db${var.user_id}${var.site_name}"
    ecs_service_name = aws_ecs_service.medium_tier.name
    ecs_cluster_name = aws_ecs_cluster.main.name
    target_group_arn = aws_lb_target_group.medium_tier_tg.arn
  })

  depends_on = [aws_db_instance.mysql]
}