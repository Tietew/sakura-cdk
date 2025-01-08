import { Names, Resource } from 'aws-cdk-lib';
import * as chatbot from 'aws-cdk-lib/aws-chatbot';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

interface SlackProps {
  readonly slackWorkspaceId: string;
  readonly slackChannelId: string;
}

export class Slack extends Resource {
  readonly channel: chatbot.SlackChannelConfiguration;
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: SlackProps) {
    super(scope, id);

    const topic = new sns.Topic(this, 'Topic');
    topic.grantPublish(new iam.ServicePrincipal('cloudwatch.amazonaws.com'));

    const channel = new chatbot.SlackChannelConfiguration(this, 'Resource', {
      slackChannelConfigurationName: Names.uniqueResourceName(this, { separator: '-' }),
      slackWorkspaceId: props.slackWorkspaceId,
      slackChannelId: props.slackChannelId,
      notificationTopics: [topic],
      guardrailPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess')],
      loggingLevel: chatbot.LoggingLevel.ERROR,
    });
    channel.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchReadOnlyAccess'));

    this.channel = channel;
    this.topic = topic;
  }

  addSubscription(topicSubscription: sns.ITopicSubscription) {
    return this.topic.addSubscription(topicSubscription);
  }
}
