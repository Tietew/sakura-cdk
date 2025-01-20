import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as custom from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as yaml from 'yaml';
import { Alarm } from './alarm';
import { Vpc } from './vpc';

interface Ec2InstanceProps {
  readonly vpc: Vpc;
  readonly topic: sns.ITopic;
  readonly hostedZone: route53.IHostedZone;
}

export class Ec2Instance extends cdk.Resource {
  readonly instance: ec2.Instance;
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: Ec2InstanceProps) {
    super(scope, id);

    const hostname = this.node.getContext('hostname') as string;
    const fqdn = `${hostname}.${props.hostedZone.zoneName}`;

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', { vpc: props.vpc, allowAllIpv6Outbound: true });
    const publicPorts = {
      HTTP: ec2.Port.HTTP,
      HTTPS: ec2.Port.HTTPS,
      SMTP: ec2.Port.SMTP,
      Submission: ec2.Port.tcp(587),
      POP3S: ec2.Port.POP3S,
      IMAPS: ec2.Port.IMAPS,
    };
    for (const [desc, port] of Object.entries(publicPorts)) {
      securityGroup.addIngressRule(ec2.Peer.anyIpv4(), port, desc);
      securityGroup.addIngressRule(ec2.Peer.anyIpv6(), port, desc);
    }

    const cloudConfig = {
      package_update: true,
      package_upgrade: true,
      timezone: 'Asia/Tokyo',
      hostname,
      fqdn,
      write_files: [
        {
          content: `[default]\nregion = ${this.env.region}\n`,
          path: '/home/ubuntu/.aws/config',
          owner: 'ubuntu:ubuntu',
          permissions: '0600',
        },
      ],
      runcmd: [
        ['chmod', '700', '/home/ubuntu/.aws'],
        ['chown', 'ubuntu:ubuntu', '-R', '/home/ubuntu'],
      ],
    };

    const instance = new ec2.Instance(this, 'Instance', {
      instanceName: hostname,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      availabilityZone: 'ap-northeast-1b',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.genericLinux({ 'ap-northeast-1': 'ami-0f448ba86f324f581' }),
      securityGroup,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            deleteOnTermination: true,
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      userData: ec2.UserData.custom(`#cloud-config\n${yaml.stringify(cloudConfig)}`),
      disableApiTermination: true,
      requireImdsv2: true,
    });
    instance.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
    instance.addSecurityGroup(props.vpc.sgMaintenance);
    instance.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceConnect'));
    instance.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    // SES
    iam.Grant.addToPrincipal({
      grantee: instance,
      actions: ['ses:Send*'],
      resourceArns: ['*'],
    });
    // Route53 (Let's Encrypt)
    iam.Grant.addToPrincipal({
      grantee: instance,
      actions: ['route53:GetChange', 'route53:GetHostedZone', 'route53:ListHostedZones*'],
      resourceArns: ['*'],
    });
    iam.Grant.addToPrincipal({
      grantee: instance,
      actions: ['route53:ChangeResourceRecordSets'],
      resourceArns: ['*'],
      conditions: {
        'ForAllValues:StringLike': { 'route53:ChangeResourceRecordSetsNormalizedRecordNames': '_acme-challenge.*' },
      },
    });
    // EC2
    iam.Grant.addToPrincipal({
      grantee: instance,
      actions: ['ssm:StartSession', 'ssm:TerminateSession'],
      resourceArns: ['*'],
    });

    const eip = new ec2.CfnEIP(this, 'EIP');
    eip.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    cdk.Tags.of(eip).add('Name', 'sakura');
    const eipAlloc = new ec2.CfnEIPAssociation(this, 'EIPAssociation', {
      instanceId: instance.instanceId,
      allocationId: eip.attrAllocationId,
    });
    eipAlloc.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const ipv6 = new custom.AwsCustomResource(this, 'GetInstanceIpv6Address', {
      installLatestAwsSdk: false,
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({ resources: ['*'] }),
      onUpdate: {
        service: 'EC2',
        action: 'describeNetworkInterfaces',
        physicalResourceId: custom.PhysicalResourceId.fromResponse('NetworkInterfaces.0.NetworkInterfaceId'),
        parameters: {
          Filters: [{ Name: 'attachment.instance-id', Values: [instance.instanceId] }],
        },
      },
    }).getResponseField('NetworkInterfaces.0.Ipv6Address');

    new route53.ARecord(this, 'ARecord', {
      zone: props.hostedZone,
      recordName: hostname,
      target: route53.RecordTarget.fromIpAddresses(eip.attrPublicIp),
    });
    new route53.AaaaRecord(this, 'AaaaRecord', {
      zone: props.hostedZone,
      recordName: hostname,
      target: route53.RecordTarget.fromIpAddresses(ipv6),
    });

    const slackAction = new actions.SnsAction(props.topic);
    new Alarm(this, 'CPUUtilizationAlarm', {
      alarmDescription: `[${this.node.path}] ${hostname} CPUUtilization >= 80`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensionsMap: { InstanceId: instance.instanceId },
      }),
      threshold: 80,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
      alarmActions: [slackAction],
      okActions: [slackAction],
    });

    new Alarm(this, 'AutoReboot', {
      alarmDescription: `[${this.node.path}] ${hostname} StatusCheckFailed`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensionsMap: { InstanceId: instance.instanceId },
        statistic: cloudwatch.Stats.MAXIMUM,
        period: cdk.Duration.minutes(1),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 10,
      alarmActions: [slackAction, new actions.Ec2Action(actions.Ec2InstanceAction.REBOOT)],
      okActions: [slackAction],
    });

    this.instance = instance;
    this.securityGroup = securityGroup;
  }
}
