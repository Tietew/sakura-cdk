import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { Alarm } from './alarm';

interface FileSystemProps {
  readonly vpc: ec2.IVpc;
  readonly topic: sns.ITopic;
}

export class FileSystem extends efs.FileSystem {
  constructor(scope: Construct, id: string, props: FileSystemProps) {
    super(scope, id, {
      ...props,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      outOfInfrequentAccessPolicy: efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS,
      removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const slackAction = new actions.SnsAction(props.topic);
    new Alarm(this, 'HighStorageAlarm', {
      alarmDescription: `[${this.node.path}] ${this.fileSystemId} Total StorageBytes > 1GiB`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EFS',
        metricName: 'StorageBytes',
        dimensionsMap: { StorageClass: 'Total', FileSystemId: this.fileSystemId },
        statistic: cloudwatch.Stats.MAXIMUM,
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1 * 1024 ** 3, // 1GiB
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 12,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      alarmActions: [slackAction],
      okActions: [slackAction],
    });
    new Alarm(this, 'LowBurstCreditAlarm', {
      alarmDescription: `[${this.node.path}] ${this.fileSystemId} BurstCreditBalance < 1GiB`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EFS',
        metricName: 'BurstCreditBalance',
        dimensionsMap: { FileSystemId: this.fileSystemId },
        statistic: cloudwatch.Stats.MAXIMUM,
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1 * 1024 ** 3, // 1GiB
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      alarmActions: [slackAction],
      okActions: [slackAction],
    });
  }
}
