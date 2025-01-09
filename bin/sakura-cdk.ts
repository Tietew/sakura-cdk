#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Ec2Stack } from '../lib/ec2-stack';
import { SharedResourcesStack } from '../lib/shared-resources-stack';

const env = { region: process.env.CDK_DEFAULT_REGION, account: process.env.CDK_DEFAULT_ACCOUNT };

const app = new cdk.App();
const shared = new SharedResourcesStack(app, 'sakura-shared', { env });
new Ec2Stack(app, 'sakura-ec2', { env, topic: shared.slack.topic });
