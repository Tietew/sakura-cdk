import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class Vpc extends ec2.Vpc {
  readonly sgMaintenance: ec2.SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id, {
      ipProtocol: ec2.IpProtocol.DUAL_STACK,
      ipAddresses: ec2.IpAddresses.cidr('172.16.0.0/16'),
      ipv6Addresses: ec2.Ipv6Addresses.amazonProvided(),
      natGateways: 0,
      availabilityZones: ['ap-northeast-1b', 'ap-northeast-1c', 'ap-northeast-1d'],
      subnetConfiguration: [
        {
          name: 'Public',
          cidrMask: 20,
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true,
          ipv6AssignAddressOnCreation: true,
        },
        {
          name: 'Private',
          cidrMask: 20,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      restrictDefaultSecurityGroup: false,
    });

    this.publicSubnets.forEach((subnet) => {
      (subnet.node.defaultChild as ec2.CfnSubnet).addPropertyOverride('PrivateDnsNameOptionsOnLaunch', {
        EnableResourceNameDnsAAAARecord: true,
        EnableResourceNameDnsARecord: true,
        HostnameType: 'resource-name',
      });
    });

    const sgMaintenance = new ec2.SecurityGroup(this, 'MaintenanceGroup', {
      vpc: this,
      allowAllOutbound: false,
    });

    const maintenance = this.node.getContext('maintenance') as string[];
    const addrs: { [key in keyof typeof ec2.AddressFamily]: string[] } = { IP_V4: [], IP_V6: [] };
    for (const ip of maintenance) {
      (ip.includes(':') ? addrs.IP_V6 : addrs.IP_V4).push(ip);
    }
    for (const family of ['IP_V4', 'IP_V6'] as const) {
      const pl = new ec2.PrefixList(this, `Maintenance${family}-L${addrs[family].length}`, {
        addressFamily: ec2.AddressFamily[family],
        entries: addrs[family].map((cidr) => ({ cidr })),
      });
      const peer = ec2.Peer.prefixList(pl.prefixListId);
      sgMaintenance.addIngressRule(peer, ec2.Port.SSH);
      sgMaintenance.addIngressRule(peer, ec2.Port.tcp(5666), 'NRPE');
      sgMaintenance.addIngressRule(peer, family === 'IP_V4' ? ec2.Port.allIcmp() : ec2.Port.allIcmpV6());
    }

    this.sgMaintenance = sgMaintenance;
  }
}
