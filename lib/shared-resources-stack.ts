import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Slack } from './resources/slack';

export class SharedResourcesStack extends cdk.Stack {
  readonly slack: Slack;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const slack = new Slack(this, 'Slack', {
      slackWorkspaceId: this.node.getContext('slackWorkspaceId'),
      slackChannelId: this.node.getContext('slackChannelId'),
    });

    const cwagent = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'cwagent.json'), {
        encoding: 'utf8',
      }),
    );
    new ssm.StringParameter(this, 'CloudWatchAgentConfig', {
      parameterName: 'AmazonCloudWatch-AgentConfig',
      description: 'Configuration of Amazon CloudWatch Agent',
      stringValue: JSON.stringify(cwagent, undefined, 2),
    });

    for (const log of cwagent.logs.logs_collected.files.collect_list) {
      new logs.LogGroup(this, `LogGroup-CWAgent-${log.log_group_name}`, {
        logGroupName: log.log_group_name,
        retention: logs.RetentionDays.SIX_MONTHS,
        removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      });
    }

    const targets = [new events_targets.SnsTopic(slack.topic)];
    new events.Rule(this, 'HealthEvent', {
      eventPattern: { source: ['aws.health'] },
      targets,
    });
    new events.Rule(this, 'GuardDutyEvent', {
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Finding'],
        detail: {
          severity: [{ numeric: ['>=', 4] }],
        },
      },
      targets,
    });
    new events.Rule(this, 'RDSEvent', {
      eventPattern: {
        source: ['aws.rds'],
        detailType: ['RDS DB Instance Event', 'RDS DB Cluster Event'],
        detail: {
          EventID: [{ 'anything-but': ['RDS-EVENT-0001', 'RDS-EVENT-0002'] }],
        },
      },
      targets,
    });
    new events.Rule(this, 'StepFunctionsEvent', {
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          status: ['FAILED', 'TIMED_OUT'],
        },
      },
      targets,
    });

    this.slack = slack;
  }
}
