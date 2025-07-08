variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_access_key_id" {
  description = "AWS Access Key ID"
  type        = string
}

variable "aws_secret_access_key" {
  description = "AWS Secret Access Key"
  type        = string
  sensitive   = true
}

variable "aws_session_token" {
  description = "AWS Session Token"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id"{
  type = string
  default = "value"
}

variable "user_id" {
  description = "User ID"
  type        = number
}
variable "domain_name" {
  description = "nom du domaine"
  type = string
  default = "mat-itops.com"
}


variable "available_cidrs" {
  description = "List of CIDRs available for site VPCs"
  type        = list(string)
  default     = ["10.0.0.0/24", "10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}


variable "site_name" {
  description = "Site name"
  type        = string
}

variable "account_id" {
  description = "AWS sub-account ID"
  type        = string
}

variable "docker_image" {
  description = "Docker image for Drupal"
  type        = string
  default = "jesstg/drupal-app:latest"
}


variable "github_repo_url" {
  description = "repo url of the user"
  type = string
  
}
