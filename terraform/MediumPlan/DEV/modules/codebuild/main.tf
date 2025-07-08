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
        Principal = { Service = "codebuild.amazonaws.com" }
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
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:sites/dev/${var.user_id}/${var.site_name}*",
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:ssh/dev/${var.user_id}/${var.site_name}*"
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
          "ecr:UploadLayerPart"
        ]
        //change ressurce to * 
        Resource = "*"
      },
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
      value = "sites/dev/${var.user_id}/${var.site_name}"
    }

    environment_variable {
      name  = "SECRET_PATH"
      value = "ssh/dev/${var.user_id}/${var.site_name}"
      
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
      pattern = format("^refs/heads/%s$", var.github_branch)
    }
  }
}

#Configurer ECR
data "aws_ecr_repository" "existing" {
  name = "${var.site_name}/drupal"
}

