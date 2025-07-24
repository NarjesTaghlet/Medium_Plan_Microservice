import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { Deployment } from './medium/entities/deployment.entity';
import { AppDataSource } from './data-source';
import { MediumService } from './medium/medium.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const queueUrl = process.env.DEPLOYMENT_QUEUE_URL!;
const pollInterval = 5000; // 5 seconds

async function pollQueue() {
  const response = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 10,
  }));

  if (!response.Messages) return;

  for (const message of response.Messages) {
    const body = JSON.parse(message.Body!);
    const { deploymentId, userId, siteName } = body;

    console.log(`📩 Received deployment task for ${siteName} (ID: ${deploymentId})`);

    try {
      const deploymentRepo = AppDataSource.getRepository(Deployment);

      const deployment = await deploymentRepo.findOneBy({ id: deploymentId });
      if (!deployment) throw new Error('Deployment not found');

      // Instantiate dependencies for MediumService
const configService = new ConfigService();
const httpService = new HttpService();
const deploymentRepository = AppDataSource.getRepository(Deployment);
const mediumService = new MediumService(deploymentRepository, httpService, configService);

      await mediumService.deployInfrastructureAndSetupGitHub(deployment);

      deployment.status = 'Active';
      deployment.updatedAt = new Date();
      await deploymentRepo.save(deployment);

      console.log(`✅ Deployment ${siteName} completed.`);

    } catch (err) {
      console.error(`❌ Deployment failed: ${err.message}`);
    }

    // Supprimer le message de la file
    await sqs.send(new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle!,
    }));
  }
}

async function startWorker() {
  console.log('🛠️ Starting deployment worker...');
  await AppDataSource.initialize();
  setInterval(pollQueue, pollInterval);
}

startWorker().catch((err) => {
  console.error('❌ Worker crashed:', err.message);
});
