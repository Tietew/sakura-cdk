#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SharedResourcesStack } from '../lib/shared-resources-stack';

const app = new cdk.App();
new SharedResourcesStack(app, 'sakura-shared');
