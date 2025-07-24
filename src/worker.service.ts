
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { Deployment } from './medium/entities/deployment.entity';
import { MediumService } from './medium/medium.service';

@Injectable()
export class WorkerService implements OnModuleInit {
  private sqs: SQSClient;
  private queueUrl: string;
  private pollInterval = 5000; // 5 secondes

  constructor(
    @InjectRepository(Deployment)
    private deploymentRepository: Repository<Deployment>,
    private mediumService: MediumService,
    private configService: ConfigService,
  ) {

     // Configuration SQS avec validation des credentials
    if (!this.configService.get('AWS_ACCESS_KEY_ID') || !this.configService.get('AWS_SECRET_ACCESS_KEY')) {
      console.error('AWS credentials are missing!');
    }

   

    const region = this.configService.get<string>('AWS_REGION');
    this.queueUrl = this.configService.get<string>('DEPLOYMENT_QUEUE_URL');
    console.log(region)
    if (!region || !this.queueUrl) {
      throw new Error('AWS_REGION ou DEPLOYMENT_QUEUE_URL non configuré');
    }
    this.sqs = new SQSClient({ region ,
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  async onModuleInit() {
    console.log('🛠️ Démarrage du worker dans l\'API...');
    setInterval(() => this.pollQueue(), this.pollInterval);
  }

  async pollQueue() {
    try {
      console.log('Interrogation de la file SQS...');
      const response = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 10,
        }),
      );

      if (!response.Messages) {
        console.log('Aucun message reçu');
        return;
      }

      for (const message of response.Messages) {
        const body = JSON.parse(message.Body!);
        const { deploymentId, userId, siteName } = body;

        console.log(`📩 Tâche de déploiement reçue pour ${siteName} (ID: ${deploymentId})`);

        try {
          const deployment = await this.deploymentRepository.findOneBy({ id: deploymentId });
          if (!deployment) throw new Error('Déploiement non trouvé');

          await this.mediumService.deployInfrastructureAndSetupGitHub(deployment);

          deployment.status = 'Active';
          deployment.updatedAt = new Date();
          await this.deploymentRepository.save(deployment);

          console.log(`✅ Déploiement ${siteName} terminé.`);

          await this.sqs.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: message.ReceiptHandle!,
            }),
          );
          console.log('Message supprimé de la file');
        } catch (err) {
          console.error(`❌ Échec du déploiement: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`❌ Échec de l'interrogation de la file: ${err.message}`);
    }
  }
}
