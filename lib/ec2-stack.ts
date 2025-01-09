import * as cdk from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as events from 'aws-cdk-lib/aws-events';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { Ec2Instance } from './resources/ec2-instance';
import { FileSystem } from './resources/filesystem';
import { ShareBucket } from './resources/share-bucket';
import { Vpc } from './resources/vpc';

interface Ec2StackProps extends cdk.StackProps {
  readonly topic: sns.ITopic;
}

export class Ec2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Ec2StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: this.node.getContext('hostedZoneId'),
      zoneName: this.node.getContext('zoneName'),
    });

    const backupVault = new backup.BackupVault(this, 'BackupVault', {
      notificationTopic: props.topic,
      notificationEvents: [
        backup.BackupVaultEvents.BACKUP_JOB_FAILED,
        backup.BackupVaultEvents.COPY_JOB_FAILED,
        backup.BackupVaultEvents.RESTORE_JOB_FAILED,
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const backupPlan = new backup.BackupPlan(this, 'BackupPlan', {
      backupVault,
      backupPlanRules: [
        new backup.BackupPlanRule({
          scheduleExpression: events.Schedule.cron({ hour: '19', minute: '0' }),
          deleteAfter: cdk.Duration.days(7),
        }),
      ],
    });

    const vpc = new Vpc(this, 'Vpc');

    const instance = new Ec2Instance(this, 'Ec2', { vpc, topic: props.topic, hostedZone });
    backupPlan.addSelection('ec2', { resources: [backup.BackupResource.fromEc2Instance(instance.instance)] });

    const vmail = new FileSystem(this, 'Vmail', { vpc });
    vmail.grantRootAccess(instance.instance);
    vmail.connections.allowDefaultPortFrom(instance.securityGroup);
    backupPlan.addSelection('efs', { resources: [backup.BackupResource.fromEfsFileSystem(vmail)] });

    const shareBucket = new ShareBucket(this, 'ShareBucket');
    shareBucket.grantReadWrite(instance.instance);
  }
}
