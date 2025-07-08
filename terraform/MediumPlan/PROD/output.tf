# Output the ALB DNS name as the public endpoint for the Drupal site
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.alb.dns_name
}

# Output the VPC CIDR block
output "vpc_cidr_block" {
  description = "The CIDR block assigned to the VPC for this site"
  value       = local.vpc_cidr
}

# Output the S3 VPC Endpoint details
output "s3_vpc_endpoint" {
  description = "Details of the S3 VPC Endpoint"
  value = {
    id         = aws_vpc_endpoint.s3.id
    dns_names  = aws_vpc_endpoint.s3.dns_entry[*].dns_name
    route_table_ids = aws_vpc_endpoint.s3.route_table_ids
  }
}

# Output the CloudWatch Logs VPC Endpoint details
output "cloudwatch_logs_vpc_endpoint" {
  description = "Details of the CloudWatch Logs VPC Endpoint"
  value = {
    id        = aws_vpc_endpoint.cloudwatch_logs.id
    dns_names = aws_vpc_endpoint.cloudwatch_logs.dns_entry[*].dns_name
    subnet_ids = aws_vpc_endpoint.cloudwatch_logs.subnet_ids
  }
}

# Output the CloudWatch Monitoring VPC Endpoint details
output "cloudwatch_monitoring_vpc_endpoint" {
  description = "Details of the CloudWatch Monitoring VPC Endpoint"
  value = {
    id        = aws_vpc_endpoint.cloudwatch_monitoring.id
    dns_names = aws_vpc_endpoint.cloudwatch_monitoring.dns_entry[*].dns_name
    subnet_ids = aws_vpc_endpoint.cloudwatch_monitoring.subnet_ids
  }
}

# Database-related outputs
output "database_endpoint" {
  description = "Endpoint of the RDS database"
  value       = aws_db_instance.mysql.endpoint
}

output "database_port" {
  description = "Port of the RDS database"
  value       = aws_db_instance.mysql.port
}

output "database_name" {
  description = "Name of the database"
  value       = substr(replace("db${var.user_id}${var.site_name}", "/[^a-zA-Z0-9_]/", "_"), 0, 64)
}

output "database_username" {
  description = "Username for the database"
  value       = aws_db_instance.mysql.username
}

output "database_password" {
  description = "Password for the database"
  value       = random_password.db_password.result
  sensitive   = true
}

# DNS placeholders (requires Cloudflare setup)
output "dns_record" {
  description = "DNS A record to point to the ALB (requires Cloudflare setup)"
  value       = "${var.site_name}.example.com"
}

output "www_dns_record" {
  description = "DNS CNAME record for www subdomain (requires Cloudflare setup)"
  value       = "www.${var.site_name}.example.com"
}

# Instance name for monitoring
output "instance_name" {
  description = "Name of the ECS cluster for monitoring purposes"
  value       = aws_ecs_cluster.main.name
}

# Outputs
output "codebuild_project_arn" {
  value = module.codebuild.project_arn
}

output "target_group_arn" {
  value = aws_lb_target_group.medium_tier_tg.arn
}


output "vpc_id" {
  value = local.vpc_id
}


output "ecs_service_name" {
  description = "Name of Service ECS"
  value = aws_ecs_service.medium_tier.name
}

output "public_subnet_ids" {
  value = length(data.aws_subnets.current_site_subnets.ids) > 0 ? data.aws_subnets.current_site_subnets.ids : [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]
}

output "private_subnet_ids" {
  value = [aws_subnet.private_subnet.id, aws_subnet.private_subnet2.id]
}


output "private_subnet" {
  value = [aws_subnet.private_subnet, aws_subnet.private_subnet2]
}

