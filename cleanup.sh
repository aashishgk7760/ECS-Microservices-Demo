#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_color() {
    color=$1
    message=$2
    echo -e "${color}${message}${NC}"
}

print_color $BLUE "🧹 Starting ECS Microservices Demo Cleanup"

# Set default values if not provided
if [ -z "$AWS_REGION" ]; then
    export AWS_REGION="us-east-1"
    print_color $YELLOW "⚠️  AWS_REGION not set, using: $AWS_REGION"
fi

export STACK_NAME="ecs-microservices-demo-ts"

print_color $BLUE "🗑️  Destroying CDK stack: $STACK_NAME"

# Delete the CDK stack
npx cdk destroy --force

print_color $BLUE "🐳 Cleaning up ECR repositories..."

# Function to delete ECR repository and all images
cleanup_ecr_repo() {
    repo_name=$1
    print_color $BLUE "Deleting ECR repository: $repo_name"

    # Delete all images in the repository first
    aws ecr list-images --repository-name $repo_name --region $AWS_REGION --query 'imageIds[*]' --output json | \
    jq '.[] | select(.imageTag != null) | "imageTag=" + .imageTag' | \
    xargs -I {} aws ecr batch-delete-image --repository-name $repo_name --image-ids {} --region $AWS_REGION 2>/dev/null || true

    # Delete images by digest if any remain
    aws ecr list-images --repository-name $repo_name --region $AWS_REGION --query 'imageIds[*]' --output json | \
    jq '.[] | select(.imageDigest != null) | "imageDigest=" + .imageDigest' | \
    xargs -I {} aws ecr batch-delete-image --repository-name $repo_name --image-ids {} --region $AWS_REGION 2>/dev/null || true

    # Delete the repository
    aws ecr delete-repository --repository-name $repo_name --force --region $AWS_REGION 2>/dev/null || true

    print_color $GREEN "✅ ECR repository $repo_name deleted"
}

# Clean up ECR repositories
cleanup_ecr_repo "microservices/api-gateway"
cleanup_ecr_repo "microservices/user-service"
cleanup_ecr_repo "microservices/order-service"

print_color $BLUE "🔐 Cleaning up secrets..."

# Delete DataDog API key secret
aws secretsmanager delete-secret \
    --secret-id "datadog-api-key" \
    --force-delete-without-recovery \
    --region $AWS_REGION 2>/dev/null || print_color $YELLOW "⚠️  DataDog secret not found or already deleted"

print_color $GREEN "✅ DataDog secret deleted"

print_color $BLUE "🧽 Cleaning up local Docker images (optional)..."

# Clean up local Docker images (optional)
docker rmi $(docker images --filter "reference=*microservices*" -q) 2>/dev/null || print_color $YELLOW "⚠️  No local microservices images to clean"

print_color $GREEN "🎉 Cleanup completed successfully!"
print_color $GREEN ""
print_color $BLUE "All AWS resources have been destroyed:"
print_color $BLUE "  ✅ ECS Cluster and Services"
print_color $BLUE "  ✅ Application Load Balancer"
print_color $BLUE "  ✅ VPC and Networking"
print_color $BLUE "  ✅ RDS PostgreSQL Database"
print_color $BLUE "  ✅ ECR Repositories"
print_color $BLUE "  ✅ CloudWatch Log Groups"
print_color $BLUE "  ✅ Secrets Manager Secrets"
print_color $GREEN ""
print_color $GREEN "💰 No more charges will be incurred for these resources!"
