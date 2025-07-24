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

print_color $BLUE "🚀 Starting ECS Microservices Demo Deployment (TypeScript CDK)"

# Check for required environment variables
if [ -z "$AWS_ACCOUNT" ]; then
    export AWS_ACCOUNT=$(aws sts get-caller-identity --query "Account" --output text)
    print_color $YELLOW "⚠️  AWS_ACCOUNT not set, using: $AWS_ACCOUNT"
fi

if [ -z "$AWS_REGION" ]; then
    export AWS_REGION="us-east-1"
    print_color $YELLOW "⚠️  AWS_REGION not set, using: $AWS_REGION"
fi

if [ -z "$DATADOG_API_KEY" ]; then
    print_color $YELLOW "⚠️  DATADOG_API_KEY not set - DataDog monitoring will be disabled"
    print_color $YELLOW "   To enable DataDog, set: export DATADOG_API_KEY=<your-key>"
fi

print_color $GREEN "✅ Account: $AWS_ACCOUNT"
print_color $GREEN "✅ Region: $AWS_REGION"

# Create DataDog API key secret if provided
if [ ! -z "$DATADOG_API_KEY" ]; then
    print_color $BLUE "📝 Creating DataDog API key secret..."
    aws secretsmanager create-secret \
        --name "datadog-api-key" \
        --description "DataDog API key for ECS monitoring" \
        --secret-string "{\"api_key\":\"$DATADOG_API_KEY\"}" \
        --region $AWS_REGION 2>/dev/null || \
    aws secretsmanager update-secret \
        --secret-id "datadog-api-key" \
        --secret-string "{\"api_key\":\"$DATADOG_API_KEY\"}" \
        --region $AWS_REGION
    print_color $GREEN "✅ DataDog API key secret created/updated"
fi

# Install dependencies
print_color $BLUE "📦 Installing CDK dependencies..."
npm install

# Bootstrap CDK if needed
print_color $BLUE "🏗️  Bootstrapping CDK..."
npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION

# Build TypeScript
print_color $BLUE "🔨 Building TypeScript..."
npm run build

# Deploy CDK stack
print_color $BLUE "🚀 Deploying CDK stack..."
export STACK_NAME="ecs-microservices-demo-ts"
npx cdk deploy --require-approval never

# Get the ALB DNS name from CloudFormation outputs
ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" \
    --output text \
    --region $AWS_REGION)

# Get ECR repository URIs
API_GATEWAY_REPO=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayRepoUri'].OutputValue" \
    --output text \
    --region $AWS_REGION)

USER_SERVICE_REPO=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='UserServiceRepoUri'].OutputValue" \
    --output text \
    --region $AWS_REGION)

ORDER_SERVICE_REPO=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='OrderServiceRepoUri'].OutputValue" \
    --output text \
    --region $AWS_REGION)

print_color $BLUE "🐳 Building and pushing Docker images..."

# Function to build and push Docker image
build_and_push() {
    service_name=$1
    repo_uri=$2
    dockerfile_path=$3

    print_color $BLUE "Building $service_name image..."

    # Get login token for ECR
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $repo_uri

    # Build image
    docker build -t $service_name $dockerfile_path

    # Tag image
    docker tag $service_name:latest $repo_uri:latest

    # Push image
    docker push $repo_uri:latest

    print_color $GREEN "✅ $service_name image pushed to $repo_uri"
}

# Build and push each service
build_and_push "api-gateway" "$API_GATEWAY_REPO" "./services/api-gateway"
build_and_push "user-service" "$USER_SERVICE_REPO" "./services/user-service"  
build_and_push "order-service" "$ORDER_SERVICE_REPO" "./services/order-service"

print_color $BLUE "🔄 Forcing ECS service updates to pull new images..."

# Update ECS services to pull new images
aws ecs update-service \
    --cluster microservices-cluster \
    --service api-gateway \
    --force-new-deployment \
    --region $AWS_REGION > /dev/null

aws ecs update-service \
    --cluster microservices-cluster \
    --service user-service \
    --force-new-deployment \
    --region $AWS_REGION > /dev/null

aws ecs update-service \
    --cluster microservices-cluster \
    --service order-service \
    --force-new-deployment \
    --region $AWS_REGION > /dev/null

print_color $BLUE "⏳ Waiting for services to stabilize (this may take a few minutes)..."
aws ecs wait services-stable \
    --cluster microservices-cluster \
    --services api-gateway user-service order-service \
    --region $AWS_REGION

print_color $GREEN "🎉 Deployment completed successfully!"
print_color $GREEN ""
print_color $GREEN "🌐 Application Load Balancer URL: http://$ALB_DNS"
print_color $GREEN ""
print_color $BLUE "Test endpoints:"
print_color $BLUE "  Health Check: http://$ALB_DNS/health"
print_color $BLUE "  Users API:    http://$ALB_DNS/api/users"
print_color $BLUE "  Orders API:   http://$ALB_DNS/api/orders"
print_color $GREEN ""
print_color $YELLOW "💡 To destroy the infrastructure: ./cleanup.sh"

if [ ! -z "$DATADOG_API_KEY" ]; then
    print_color $GREEN "📊 DataDog monitoring is enabled - check your DataDog dashboard!"
fi
