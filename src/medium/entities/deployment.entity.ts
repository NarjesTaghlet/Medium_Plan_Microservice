import { Entity, Column, PrimaryGeneratedColumn ,UpdateDateColumn, 
    CreateDateColumn, 
    Unique} from 'typeorm';

@Entity()
export class Deployment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column(
    { unique: true }
  )
  siteName: string;

  @Column()
  cloudflareDomain: string;

  @Column()
  selectedStack: string;

  @Column()
  status: string;

  @Column({ nullable: true })
  instancePublicIp: string;

  @Column({ nullable: true })
  instancePublicIp_dev: string;
  

  @Column({ nullable: true })
  userRepoUrl: string;

  @Column({ nullable: true })
  orgRepoUrl: string;

  @Column({ nullable: true })
  secretsManagerArn: string;

  @CreateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @Column({ nullable: true, type: 'text' })
  sshPrivateKey: string; 

  @Column({ nullable: true })
  AlbDns: string;

  @Column({ nullable: true })
  instanceName_dev: string;

  @Column({ nullable: true })
  clusterName: string;




}

