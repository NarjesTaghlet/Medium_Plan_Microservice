# Retrieve GitHub PAT from Secrets Manager
data "aws_secretsmanager_secret_version" "github_pat" {
  secret_id = "sites/${var.user_id}/github-pat"
}

# CodeBuild Source Credential for GitHub
resource "aws_codebuild_source_credential" "github_credential" {
  auth_type   = "PERSONAL_ACCESS_TOKEN"
  server_type = "GITHUB"
  token       = data.aws_secretsmanager_secret_version.github_pat.secret_string
}

# CodeBuild IAM Role
resource "aws_iam_role" "codebuild_role" {
  name = "${var.project_name}-codebuild-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = ["codebuild.amazonaws.com","ecs-tasks.amazonaws.com" ]}
        Action    = "sts:AssumeRole"
      }
      
    ]
  })
}

resource "aws_iam_role_policy" "codebuild_policy" {
  name = "${var.project_name}-codebuild-policy"
  role = aws_iam_role.codebuild_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
           "codebuild:StartBuild",
           "codebuild:StartBuildBatch",
                     "ecs:DescribeServices",
                     "rds:DescribeDBInstances",
          "rds:RestoreDBInstanceFromDBSnapshot",
          "rds:RestoreDBInstanceToPointInTime",
          "rds:ModifyDBInstance",
          "rds:DeleteDBInstance",
          "rds:StopDBInstance",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition"

        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:sites/${var.user_id}/${var.site_name}*",
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:ssh/${var.user_id}/${var.site_name}*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["lightsail:*"]
        Resource = "*"
      },
       {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
          "ecs:DescribeServices"
        ]
        //change ressurce to * 
        Resource = "*"
      },
      {
      Effect   = "Allow"
      Action   = "iam:PassRole"
      Resource = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ecs-task-role-*",
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ecs-task-execution-role-*"
      ]
    }
    ]
  })
}

data "aws_caller_identity" "current" {}

# CodeBuild Project
resource "aws_codebuild_project" "project" {
  name          = var.project_name
  description   = "CodeBuild project for Drupal deployment"
  service_role  = aws_iam_role.codebuild_role.arn
  build_timeout = "60"

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true

    environment_variable {
      name  = "USER_ID"
      value = var.user_id
    }

    environment_variable {
      name  = "SITE_NAME"
      value = var.site_name
    }

    environment_variable {
      name  = "TARGET_IP"
      value = var.target_ip
    }

    environment_variable {
      name  = "SSH_USER"
      value = var.ssh_user
    }

    environment_variable {
      name  = "SITE_SECRET_NAME"
      value = "sites/${var.user_id}/${var.site_name}"
    }

    environment_variable {
      name  = "DOCKER_IMAGE"
      value = var.docker_image
    }

    environment_variable {
      name  = "DB_PORT"
      value = var.db_port
    }


    environment_variable {
      name  = "AWS_REGION"
      value = var.aws_region
    }

   environment_variable {
      name ="ECS_CLUSTER_NAME"
      value = var.ecs_cluster_name
    }

     environment_variable {
      name ="ECS_SERVICE_NAME"
      value = var.ecs_service_name
    }
  
  }

  source {
    type            = "GITHUB"
    location        = var.github_repo
    git_clone_depth = 1
    buildspec       = var.buildspec_path
  }

  logs_config {
    cloudwatch_logs {
      status = "ENABLED"
    }
  }

  depends_on = [aws_codebuild_source_credential.github_credential]

}

# CodeBuild Webhook
resource "aws_codebuild_webhook" "webhook" {
  count        = var.enable_webhook ? 1 : 0
  project_name = aws_codebuild_project.project.name

  filter_group {
    filter {
      type    = "EVENT"
      pattern = "PUSH"
    }
    filter {
      type    = "HEAD_REF"
      pattern = var.github_branch
    }
  }
}

#Configurer ECR
resource "aws_ecr_repository" "app" {
  name = "${var.site_name}/drupal"
  encryption_configuration {
    encryption_type = "AES256"
  }
  image_tag_mutability = "MUTABLE"

  tags = {
    Name        = "${var.site_name}-drupal-app"
    UserId      = var.user_id
    Environment = "Production"
  }
    force_delete = true  #

}


# Attach a policy to the ECR repository to allow Lightsail to pull images
resource "aws_ecr_repository_policy" "lightsail_ecr_policy" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "AllowLightsailPull",
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "lightsail.amazonaws.com"
        },
        "Action" : [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = <<EOF
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Remove untagged images after 5 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 5
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 2,
      "description": "Keep 10 latest image versions used in test environment",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["dev"],
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 3,
      "description": "Keep 100 latest image versions used in prod environment",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod"],
        "countType": "imageCountMoreThan",
        "countNumber": 100
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
EOF
}


