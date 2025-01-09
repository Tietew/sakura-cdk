import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

interface AlarmProps extends cloudwatch.AlarmProps {
  readonly alarmActions?: cloudwatch.IAlarmAction[];
  readonly okActions?: cloudwatch.IAlarmAction[];
  readonly insufficientDataActions?: cloudwatch.IAlarmAction[];
}

export class Alarm extends cloudwatch.Alarm {
  constructor(scope: Construct, id: string, props: AlarmProps) {
    const { alarmActions, okActions, insufficientDataActions, ...alarmProps } = props;
    super(scope, id, alarmProps);

    alarmActions?.forEach((action) => this.addAlarmAction(action));
    okActions?.forEach((action) => this.addOkAction(action));
    insufficientDataActions?.forEach((action) => this.addInsufficientDataAction(action));
  }
}
