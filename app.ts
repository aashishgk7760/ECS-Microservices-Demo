import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsMicroservicesStack } from './infrastructure/ecs-microservices-stack';

const app = new cdk.App();

const stackName = process.env.STACK_NAME || 'ecs-microservices-demo';
const account = process.env.AWS_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';

new EcsMicroservicesStack(app, stackName, {
  env: {
    account,
    region,
  },
  description: 'ECS Microservices Demo with DataDog Monitoring & AWS Service Discovery (TypeScript)',
});

app.synth();
