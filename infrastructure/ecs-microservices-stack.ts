import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';

export interface EcsMicroservicesStackProps extends cdk.StackProps {}

export class EcsMicroservicesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: EcsMicroservicesStackProps) {
    super(scope, id, props);

    // Get DataDog API key from environment or use placeholder
    const datadogApiKey = process.env.DATADOG_API_KEY;

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'MicroservicesVpc', {
      maxAzs: 2,
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });
    
    // Create security group for task role
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });

    // Create security group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });
    
    // Allow HTTP traffic to ALB
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );
    
    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'MicroservicesALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'microservices-alb',
      securityGroup: albSecurityGroup,
    });
    
    // Allow traffic from ALB to task security group
    taskSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow traffic from ALB to API Gateway'
    );

    // Create ALB listener
    const listener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'MicroservicesCluster', {
      vpc,
      clusterName: 'microservices-cluster',
      containerInsights: true,
    });

    // Create Cloud Map namespace for service discovery
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'ServiceNamespace', {
      name: 'microservices.local',
      vpc,
      description: 'Service discovery namespace for microservices',
    });

    // Create RDS PostgreSQL database
    const dbCredentials = rds.Credentials.fromGeneratedSecret('postgres', {
      secretName: 'microservices-db-credentials',
    });

    // Create security group for database
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });
    
    // Allow PostgreSQL traffic from task security group to database
    dbSecurityGroup.addIngressRule(
      taskSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL traffic from ECS tasks'
    );

    const database = new rds.DatabaseInstance(this, 'PostgresDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_4,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: dbCredentials,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'microservices',
      allocatedStorage: 20,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create DataDog API key secret if provided
    let datadogSecret: secretsmanager.ISecret | undefined;
    if (datadogApiKey) {
      datadogSecret = new secretsmanager.Secret(this, 'DatadogApiKey', {
        secretName: 'datadog-api-key',
        secretStringValue: cdk.SecretValue.unsafePlainText(datadogApiKey),
      });
    }

    // Create ECR repositories for each service
    const repositories = {
      apiGateway: new ecr.Repository(this, 'ApiGatewayRepo', {
        repositoryName: 'microservices/api-gateway',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteImages: true,
      }),
      userService: new ecr.Repository(this, 'UserServiceRepo', {
        repositoryName: 'microservices/user-service',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteImages: true,
      }),
      orderService: new ecr.Repository(this, 'OrderServiceRepo', {
        repositoryName: 'microservices/order-service',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteImages: true,
      }),
    };

    // Create CloudWatch log groups
    const logGroups = {
      apiGateway: new logs.LogGroup(this, 'ApiGatewayLogGroup', {
        logGroupName: '/ecs/api-gateway',
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      userService: new logs.LogGroup(this, 'UserServiceLogGroup', {
        logGroupName: '/ecs/user-service',
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      orderService: new logs.LogGroup(this, 'OrderServiceLogGroup', {
        logGroupName: '/ecs/order-service',
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    };

    // Create task execution role
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Add permissions for secrets if DataDog is configured
    if (datadogSecret) {
      datadogSecret.grantRead(taskExecutionRole);
    }

    // Grant access to database secret
    database.secret!.grantRead(taskExecutionRole);

    // Create task role for services
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Helper function to create DataDog sidecar container
    const createDatadogSidecar = (serviceName: string): ecs.ContainerDefinitionOptions | undefined => {
      if (!datadogSecret) return undefined;

      return {
        containerName: 'datadog-agent',
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/datadog/agent:latest'),
        memoryLimitMiB: 256,
        cpu: 100,
        essential: false,
        environment: {
          'DD_SITE': 'datadoghq.com',
          'DD_APM_ENABLED': 'true',
          'DD_APM_NON_LOCAL_TRAFFIC': 'true',
          'DD_DOGSTATSD_NON_LOCAL_TRAFFIC': 'true',
          'DD_LOGS_ENABLED': 'true',
          'DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL': 'true',
          'DD_SERVICE': serviceName,
          'DD_ENV': 'production',
          'DD_VERSION': '1.0.0',
          'ECS_FARGATE': 'true',
        },
        secrets: {
          'DD_API_KEY': ecs.Secret.fromSecretsManager(datadogSecret),
        },
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'datadog-agent',
          logGroup: logGroups[serviceName as keyof typeof logGroups],
        }),
      };
    };

    // Create User Service
    const userServiceTaskDef = new ecs.FargateTaskDefinition(this, 'UserServiceTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    const userServiceContainer = userServiceTaskDef.addContainer('user-service', {
      image: ecs.ContainerImage.fromEcrRepository(repositories.userService, 'latest'),
      memoryLimitMiB: 256,
      cpu: 128,
      environment: {
        'DD_AGENT_HOST': 'localhost',
        'DD_TRACE_AGENT_PORT': '8126',
        'DD_SERVICE': 'user-service',
        'DD_ENV': 'production',
        'DD_VERSION': '1.0.0',
      },
      secrets: {
        'DATABASE_HOST': ecs.Secret.fromSecretsManager(database.secret!, 'host'),
        'DATABASE_USER': ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        'DATABASE_PASSWORD': ecs.Secret.fromSecretsManager(database.secret!, 'password'),
        'DATABASE_NAME': ecs.Secret.fromSecretsManager(database.secret!, 'dbname'),
      },
      portMappings: [{
        name: 'user-service',
        containerPort: 8000,
        protocol: ecs.Protocol.TCP,
      }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'user-service',
        logGroup: logGroups.userService,
      }),
    });

    // Add DataDog sidecar if configured
    const userServiceDatadog = createDatadogSidecar('userService');
    if (userServiceDatadog) {
      userServiceTaskDef.addContainer('datadog-agent', userServiceDatadog);
    }

    const userService = new ecs.FargateService(this, 'UserService', {
      cluster,
      taskDefinition: userServiceTaskDef,
      desiredCount: 1,
      serviceName: 'user-service',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [taskSecurityGroup],
      serviceConnectConfiguration: {
        namespace: namespace.namespaceName,
        services: [{
          portMappingName: 'user-service',
          dnsName: 'user-service',
          port: 8000,
          discoveryName: 'user-service'
        }],
      },
    });

    // Create Order Service
    const orderServiceTaskDef = new ecs.FargateTaskDefinition(this, 'OrderServiceTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    const orderServiceContainer = orderServiceTaskDef.addContainer('order-service', {
      image: ecs.ContainerImage.fromEcrRepository(repositories.orderService, 'latest'),
      memoryLimitMiB: 256,
      cpu: 128,
      environment: {
        'DD_AGENT_HOST': 'localhost',
        'DD_TRACE_AGENT_PORT': '8126',
        'DD_SERVICE': 'order-service',
        'DD_ENV': 'production',
        'DD_VERSION': '1.0.0',
      },
      secrets: {
        'DATABASE_HOST': ecs.Secret.fromSecretsManager(database.secret!, 'host'),
        'DATABASE_USER': ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        'DATABASE_PASSWORD': ecs.Secret.fromSecretsManager(database.secret!, 'password'),
        'DATABASE_NAME': ecs.Secret.fromSecretsManager(database.secret!, 'dbname'),
      },
      portMappings: [{
        name: 'order-service',
        containerPort: 8000,
        protocol: ecs.Protocol.TCP,
      }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'order-service',
        logGroup: logGroups.orderService,
      }),
    });

    // Add DataDog sidecar if configured
    const orderServiceDatadog = createDatadogSidecar('orderService');
    if (orderServiceDatadog) {
      orderServiceTaskDef.addContainer('datadog-agent', orderServiceDatadog);
    }

    const orderService = new ecs.FargateService(this, 'OrderService', {
      cluster,
      taskDefinition: orderServiceTaskDef,
      desiredCount: 1,
      serviceName: 'order-service',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [taskSecurityGroup],
      serviceConnectConfiguration: {
        namespace: namespace.namespaceName,
        services: [{
          portMappingName: 'order-service',
          dnsName: 'order-service',
          port: 8000,
          discoveryName: 'order-service'
        }],
      },
    });

    // Create API Gateway Service
    const apiGatewayTaskDef = new ecs.FargateTaskDefinition(this, 'ApiGatewayTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    const apiGatewayContainer = apiGatewayTaskDef.addContainer('api-gateway', {
      image: ecs.ContainerImage.fromEcrRepository(repositories.apiGateway, 'latest'),
      memoryLimitMiB: 256,
      cpu: 128,
      environment: {
        'DD_AGENT_HOST': 'localhost',
        'DD_TRACE_AGENT_PORT': '8126',
        'DD_SERVICE': 'api-gateway',
        'DD_ENV': 'production',
        'DD_VERSION': '1.0.0',
        'USER_SERVICE_URL': 'http://user-service:8000',
        'ORDER_SERVICE_URL': 'http://order-service:8000',
      },
      portMappings: [{
        name: 'api-gateway',
        containerPort: 8000,
        protocol: ecs.Protocol.TCP,
      }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api-gateway',
        logGroup: logGroups.apiGateway,
      }),
    });

    // Add DataDog sidecar if configured
    const apiGatewayDatadog = createDatadogSidecar('apiGateway');
    if (apiGatewayDatadog) {
      apiGatewayTaskDef.addContainer('datadog-agent', apiGatewayDatadog);
    }

    const apiGatewayService = new ecs.FargateService(this, 'ApiGatewayService', {
      cluster,
      taskDefinition: apiGatewayTaskDef,
      desiredCount: 1,
      serviceName: 'api-gateway',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [taskSecurityGroup],
      serviceConnectConfiguration: {
        namespace: namespace.namespaceName,
        services: [{
          portMappingName: 'api-gateway',
          dnsName: 'api-gateway',
          port: 8000,
          discoveryName: 'api-gateway'
        }],
      },
    });

    // Create target group for API Gateway
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiGatewayTargetGroup', {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: '200',
      },
    });

    // Add API Gateway service to target group
    apiGatewayService.attachToApplicationTargetGroup(targetGroup);

    // Add target group to listener
    listener.addTargetGroups('ApiGatewayTarget', {
      targetGroups: [targetGroup],
    });

    // Configure auto scaling for services
    const userServiceScaling = userService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5,
    });

    userServiceScaling.scaleOnCpuUtilization('UserServiceCpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    const orderServiceScaling = orderService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5,
    });

    orderServiceScaling.scaleOnCpuUtilization('OrderServiceCpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    const apiGatewayScaling = apiGatewayService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5,
    });

    apiGatewayScaling.scaleOnCpuUtilization('ApiGatewayCpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2),
    });

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
      exportName: 'MicroservicesALBDnsName',
    });

    new cdk.CfnOutput(this, 'LoadBalancerURL', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Application Load Balancer URL',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });

    // Output ECR repository URIs
    new cdk.CfnOutput(this, 'ApiGatewayRepoUri', {
      value: repositories.apiGateway.repositoryUri,
      description: 'API Gateway ECR repository URI',
    });

    new cdk.CfnOutput(this, 'UserServiceRepoUri', {
      value: repositories.userService.repositoryUri,
      description: 'User Service ECR repository URI',
    });

    new cdk.CfnOutput(this, 'OrderServiceRepoUri', {
      value: repositories.orderService.repositoryUri,
      description: 'Order Service ECR repository URI',
    });
  }
}
