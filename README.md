# ECS Microservices Demo with DataDog Monitoring & AWS Service Discovery (TypeScript CDK)

A complete production-ready microservices architecture using AWS ECS Fargate, with CloudMap service discovery, DataDog APM monitoring, and infrastructure provisioned entirely with AWS CDK in TypeScript.

## 🏗️ Architecture Overview

This project demonstrates a modern microservices architecture with:

- **Three Python microservices**: API Gateway (Flask), User Service (FastAPI), Order Service (Flask)
- **ECS Fargate**: Serverless container hosting with auto-scaling
- **AWS Service Discovery**: Private DNS-based service discovery via CloudMap and ECS Service Connect
- **Application Load Balancer**: Internet-facing entry point with health checks
- **RDS PostgreSQL**: Managed database with automated backups
- **DataDog Integration**: Full-stack monitoring with metrics, logs, and distributed tracing
- **Infrastructure as Code**: Everything defined in CDK TypeScript

## 📁 Project Structure

```
ecs-microservices-demo-typescript/
├── app.ts                          # CDK app entry point
├── cdk.json                        # CDK configuration
├── package.json                    # Node.js dependencies
├── tsconfig.json                   # TypeScript configuration
├── deploy.sh                       # One-click deployment script
├── cleanup.sh                      # Clean up script
├── infrastructure/
│   └── ecs-microservices-stack.ts  # Main CDK stack
├── services/
│   ├── api-gateway/                # Flask API proxy service
│   │   ├── app.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── user-service/               # FastAPI + AsyncPG service
│   │   ├── app.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── order-service/              # Flask + psycopg2 service
│       ├── app.py
│       ├── requirements.txt
│       └── Dockerfile
└── README.md                       # This file
```

## 🚀 Quick Start

### Prerequisites

- **AWS CLI** configured with appropriate permissions
- **Node.js** 18+ and npm
- **Docker** installed and running
- **AWS CDK** v2 installed globally: `npm install -g aws-cdk`
- **DataDog account** (optional but recommended for monitoring)

### Environment Setup

```bash
# Clone or extract the project
cd ecs-microservices-demo-typescript

# Set required environment variables
export AWS_ACCOUNT=<your-aws-account-id>
export AWS_REGION=us-east-1  # or your preferred region

# Optional: Enable DataDog monitoring
export DATADOG_API_KEY=<your-datadog-api-key>
```

### One-Click Deployment

```bash
chmod +x deploy.sh
./deploy.sh
```

The deployment script will:
1. Install CDK dependencies
2. Bootstrap CDK in your account/region
3. Build TypeScript infrastructure code
4. Deploy the CDK stack (VPC, ALB, ECS, RDS, etc.)
5. Build and push Docker images to ECR
6. Update ECS services with new images
7. Wait for services to stabilize
8. Display the Application Load Balancer URL

### Testing the API

Once deployed, test the endpoints:

```bash
# Get the ALB URL from deployment output
export ALB_URL="http://your-alb-dns-name"

# Health check
curl $ALB_URL/health

# Users API
curl $ALB_URL/api/users
curl -X POST $ALB_URL/api/users -H "Content-Type: application/json" -d '{"name":"John Doe","email":"john@example.com","age":30}'

# Orders API  
curl $ALB_URL/api/orders
curl -X POST $ALB_URL/api/orders -H "Content-Type: application/json" -d '{"user_id":1,"product":"Laptop","quantity":1,"price":999.99}'
```

## 🏗️ Infrastructure Components

### Networking
- **VPC**: Multi-AZ setup with public, private, and database subnets
- **Application Load Balancer**: Internet-facing with health checks
- **NAT Gateway**: Outbound internet access for private subnets

### Compute
- **ECS Fargate Cluster**: Serverless container hosting
- **Auto Scaling**: CPU-based scaling (1-5 tasks per service)
- **Service Connect**: Automatic service discovery and load balancing

### Data
- **RDS PostgreSQL**: t3.micro instance with automated backups
- **Secrets Manager**: Database credentials and DataDog API key

### Monitoring & Logging
- **CloudWatch Logs**: Centralized logging for all services
- **DataDog Agent**: Sidecar containers for APM and metrics
- **Container Insights**: ECS performance monitoring

### Security
- **IAM Roles**: Least-privilege access for ECS tasks
- **Security Groups**: Network-level access control
- **Private Subnets**: Database isolation

## 📊 DataDog Integration

When `DATADOG_API_KEY` is provided, each microservice gets a DataDog agent sidecar that automatically:

- **Collects Metrics**: CPU, memory, network, custom application metrics
- **Streams Logs**: All application and infrastructure logs
- **Traces Requests**: Distributed tracing across service boundaries
- **Monitors Health**: Service availability and performance

### DataDog Dashboard Features
- Service map showing request flows
- APM traces with timing breakdowns
- Infrastructure metrics and alerts
- Log correlation with traces

## 🛠️ Development Workflow

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Synthesize CloudFormation template
npm run synth

# Run tests (when available)
npm test
```

### Updating Services

```bash
# Make changes to service code
# Rebuild and redeploy
./deploy.sh
```

### Infrastructure Changes

```bash
# Modify infrastructure/ecs-microservices-stack.ts
# Deploy changes
npm run deploy
```

## 🧹 Cleanup

**Important**: Always clean up resources to avoid ongoing charges:

```bash
chmod +x cleanup.sh
./cleanup.sh
```

This will:
- Destroy the CDK stack and all AWS resources
- Delete ECR repositories and container images
- Remove Secrets Manager secrets
- Clean up local Docker images

## 💰 Cost Optimization

### Estimated Monthly Costs (us-east-1)
- **ECS Fargate**: ~$15-30 (3 tasks, t3.micro equivalent)
- **RDS t3.micro**: ~$12-15
- **Application Load Balancer**: ~$16
- **NAT Gateway**: ~$32 
- **CloudWatch Logs**: ~$1-5
- **DataDog**: Varies by plan
- **Total**: ~$75-100/month

### Cost-Saving Tips
- Use Spot pricing for non-production workloads
- Configure CloudWatch log retention (currently 1 week)
- Scale down RDS instance type if needed
- Consider Fargate Spot for batch workloads

## 🔧 Configuration Options

### Environment Variables
- `AWS_ACCOUNT`: Target AWS account ID
- `AWS_REGION`: Deployment region (default: us-east-1)
- `DATADOG_API_KEY`: Enable DataDog monitoring
- `STACK_NAME`: CDK stack name (default: ecs-microservices-demo-ts)

### CDK Context
Modify `cdk.json` to adjust CDK behavior and feature flags.

### Service Configuration
Each service can be configured via environment variables in the task definitions.

## 🚦 API Endpoints

### API Gateway Service (Port 8000)
- `GET /health` - Health check
- `GET /` - Service info
- `GET|POST /api/users` - Proxy to User Service
- `GET|PUT|DELETE /api/users/{id}` - Proxy to User Service
- `GET|POST /api/orders` - Proxy to Order Service
- `GET|PUT|DELETE /api/orders/{id}` - Proxy to Order Service

### User Service (Port 8000)
- `GET /health` - Health check
- `GET /docs` - FastAPI documentation
- `GET /users` - List all users
- `POST /users` - Create user
- `GET /users/{id}` - Get user by ID
- `PUT /users/{id}` - Update user
- `DELETE /users/{id}` - Delete user

### Order Service (Port 8000)
- `GET /health` - Health check
- `GET /orders` - List all orders
- `POST /orders` - Create order
- `GET /orders/{id}` - Get order by ID
- `PUT /orders/{id}` - Update order
- `DELETE /orders/{id}` - Delete order

## 🛡️ Security Best Practices

- All services run in private subnets
- Database in isolated subnets with no internet access
- IAM roles follow least-privilege principle
- Secrets stored in AWS Secrets Manager
- Container images scanned for vulnerabilities
- Non-root user in Docker containers

## 🔄 Service Discovery

Services communicate using AWS ECS Service Connect:
- **DNS Names**: `user-service`, `order-service`, `api-gateway`
- **Load Balancing**: Automatic with health checks
- **Failover**: Automatic rerouting to healthy instances
- **Zero-Config**: No manual IP or port management

## 📝 Troubleshooting

### Common Issues

1. **Services not starting**: Check CloudWatch logs for each service
2. **Database connection issues**: Verify security groups and credentials
3. **Image pull errors**: Ensure ECR repositories exist and images are pushed
4. **ALB health check failures**: Check service health endpoints

### Debugging Commands

```bash
# Check ECS service status
aws ecs describe-services --cluster microservices-cluster --services api-gateway user-service order-service

# View CloudWatch logs
aws logs describe-log-groups --log-group-name-prefix /ecs/

# Check ALB target health
aws elbv2 describe-target-health --target-group-arn <target-group-arn>
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- AWS CDK team for excellent documentation
- DataDog for comprehensive monitoring
- FastAPI and Flask communities
- Open source contributors

---

**Happy Building!** 🚀

For questions or issues, please check the troubleshooting section or create an issue in the repository.
