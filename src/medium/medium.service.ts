import * as AWS from 'aws-sdk';
import { spawn } from 'child_process';
import {  resolve } from 'path';
import { Repository } from 'typeorm';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {  GetSecretValueCommand,PutSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import { firstValueFrom } from 'rxjs';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { Injectable, Logger , BadRequestException } from '@nestjs/common';
import { SecretsManagerClient,UpdateSecretCommand,CreateSecretCommand } from '@aws-sdk/client-secrets-manager';
import { Deployment } from './entities/deployment.entity';
import * as fs from 'fs-extra';
import { InjectRepository } from '@nestjs/typeorm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { NotFoundException } from '@nestjs/common';

import {
  ECSClient,
  UpdateServiceCommand,
  ListContainerInstancesCommand,
  DeregisterContainerInstanceCommand,
  DeleteServiceCommand,
  UpdateClusterCommand,
  DeleteCapacityProviderCommand,
  DeleteClusterCommand,
  DescribeServicesCommand,
  PutClusterCapacityProvidersCommand,
  ListTasksCommand,
  StopTaskCommand
} from '@aws-sdk/client-ecs';
import { AutoScalingClient, UpdateAutoScalingGroupCommand, DeleteAutoScalingGroupCommand } from '@aws-sdk/client-auto-scaling';
import { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand } from '@aws-sdk/client-ec2';

import { 
  readFileSync, 
 
} from 'fs';
import { join } from 'path';
import * as path from 'path';
import logger from 'src/utils/logger';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv' ;
import { promisify } from 'util';
import { exec } from 'child_process';
import { HttpService } from '@nestjs/axios';



import { HttpException,HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Define the execPromise utility for running Terraform commands
const execPromise = promisify(exec);

dotenv.config();
const execAsync = promisify(exec);


// Define the logger
@Injectable()
export class MediumService {
  private readonly githubToken: string;
  private readonly payloadFile = 'github_payload.json';
 
  private readonly githubApiUrl = 'https://api.github.com';
    private readonly sqsClient = new SQSClient({ region: process.env.AWS_REGION });

  private readonly orgName ='NarjesTg' ;
  private readonly templaterepo = 'Template-Basic'
  //return the real github token 
 // private readonly webhookSecret = process.env.WEBHOOK_SECRET; // Webhook secret
 // private readonly webhookUrl = ' https://ddf0-2c0f-f698-4097-5566-4560-c960-b6f0-e696.ngrok-free.app/api/webhooks/github'; // Replace with your ngrok URL
  private readonly webhookUrl = 'https://3e1d-2c0f-f698-4097-5566-4560-c960-b6f0-e696.ngrok-free.app/deployment/github'; // Replace with your ngrok URL
  private readonly cloudflareZoneId: string;
private readonly cloudflareApiToken: string;
  private readonly userServiceUrl = this.configService.get<string>('USER_SERVICE_URL', 'http://localhost:3030');


    constructor(
      @InjectRepository(Deployment)
       private deploymentRepository: Repository<Deployment>,
        private httpService: HttpService,
        private configService : ConfigService
        
    ){
     // this.githubToken = process.env.GITHUB_PAT;
     this.cloudflareZoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
  this.cloudflareApiToken = this.configService.get<string>('CLOUDFLARE_API_TOKEN');

    }

    async fetchTempCredentials(userId: number) {
  try {
    // Utilise une variable d'environnement pour l'URL du user-service
const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL', 'http://localhost:3030');
    const { data } = await firstValueFrom(
      this.httpService.post(`${userServiceUrl}/user/${userId}/connect-aws`, {})
    );
    console.log(`Fetched AWS credentials for user ${userId}`);
    return data;
  } catch (error) {
    console.error(`Error fetching AWS credentials for user ${userId}: ${error.message}`);
    throw error;
  }
}


    async findAllForUser(userId: number): Promise<Deployment[]> {
      return await this.deploymentRepository.find({ where: { userId } });
    }

    async isSiteNameUnique(siteName: string): Promise<{ available: boolean }> {
     const normalized = String(siteName).toLowerCase()
    const exists = await this.deploymentRepository.exist({
      where: { siteName: normalized }
    });

    console.log("exists",exists)
    
    return { available: !exists };
  }

     
    
    private async getUserById(userId: number) {
      try {
        const response = await firstValueFrom(
          this.httpService.get(`${this.userServiceUrl}/user/userid/${userId}`),
        );
        return response.data; // Suppose que la réponse contient { id, username, githubToken, ... }
      } catch (error) {
        console.error(`Failed to fetch user: ${error.message}`);
        throw new Error(`Could not fetch user with ID ${userId}`);
      }
    }
  
    private getAuthHeaders() {
      return {
        Authorization: `token ${this.githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };
    }
  
    private getUserAuthHeaders(userGithubToken: string) {
      return {
        Authorization: `token ${userGithubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      };
    }
    
/*
    async createDeployment(userId: number, siteName: string, cloudflareDomain: string, selectedStack: string ): Promise<Deployment> {
        // Create the deployment record with initial status "Pending"
        //lowercase siteName
        let SiteName = siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

        const deployment = this.deploymentRepository.create({
          userId,
          siteName: SiteName,
          cloudflareDomain,
          selectedStack,
          status: 'Pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await this.deploymentRepository.save(deployment);
    
        try {
          // Perform the deployment (Terraform, GitHub setup, etc.)
        await this.deployInfrastructureAndSetupGitHub(deployment);
           

          // Update status to "Active" on success
          deployment.status = 'Active';
          deployment.updatedAt = new Date();
        
          await this.deploymentRepository.save(deployment);
        } catch (error) {
          // Update status to "Failed" on error
          deployment.status = 'Failed';
          deployment.updatedAt = new Date();
    
          //deploy stack by triggering the pipeline !   => in the deploy    deployInfrastructureAndSetupGitHub function after
          //executing infra deploy !
           
    
          await this.deploymentRepository.save(deployment);
    
    
          throw new Error(`Deployment failed: ${error.message}`);
        }
    
        return deployment;
      }
*/

/* async createDeployment(userId: number, siteName: string, cloudflareDomain: string, selectedStack: string): Promise<Deployment> {
    const SiteName = siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const deployment = this.deploymentRepository.create({
      userId,
      siteName: SiteName,
      cloudflareDomain,
      selectedStack,
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.deploymentRepository.save(deployment);

    const message = {
      deploymentId: deployment.id,
      userId,
      siteName: SiteName,
    };

    console.log(process.env.DEPLOYMENT_QUEUE_URL)

    const command = new SendMessageCommand({
      QueueUrl: process.env.DEPLOYMENT_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    });

    try {
      await this.sqsClient.send(command);
      console.log(`✅ Message sent to SQS for deployment ${deployment.id}`);
    } catch (err) {
      console.error(`❌ Failed to send to SQS: ${err.message}`);
      throw new Error('Could not enqueue deployment job.');
    }

    return deployment;
  }
*/
async createDeployment(
  userId: number,
  siteName: string,
  cloudflareDomain: string,
  selectedStack: string
): Promise<{ deploymentId: number }> {
  // 🔤 Nettoyer le nom du site
  const SiteName = siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // 🗂️ Créer le déploiement dans la BDD
  const deployment = this.deploymentRepository.create({
    userId,
    siteName: SiteName,
    cloudflareDomain,
    selectedStack,
    status: 'Pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await this.deploymentRepository.save(deployment);

  // 🔁 Déclenche Terraform en arrière-plan (non bloquant)
  this.deployInfrastructureAndSetupGitHub(deployment)
    .then(async () => {
      deployment.status = 'Active';
      deployment.updatedAt = new Date();
      await this.deploymentRepository.save(deployment);
      console.log(`✅ Deployment ${deployment.id} completed`);
    })
    .catch(async (error) => {
      deployment.status = 'Failed';
      deployment.updatedAt = new Date();
      await this.deploymentRepository.save(deployment);
      console.error(`❌ Deployment ${deployment.id} failed:`, error.message);
    });

  // ✅ Réponse immédiate pour le frontend
  return { deploymentId: deployment.id };
}

      async getDeploymentStatus( id: number) {
        const deployment = await this.deploymentRepository.findOneBy({ id });
      
        if (!deployment) {
          throw new NotFoundException('Deployment not found');
        }
      
        return { status: deployment.status };
      }


    async deployInfrastructureAndSetupGitHub(deployment: Deployment) {


      try {
         // Step 4: Configuration GitHub
        const userGithubToken = await  this.fetchGitHubPat(deployment.userId)

         const githubResult = await this.setupUserDeployment(deployment.userId, deployment.siteName,userGithubToken);
         deployment.userRepoUrl = githubResult.userRepoUrl;
        // deployment.orgRepoUrl = githubResult.orgRepoUrl;
         await this.deploymentRepository.save(deployment);
    
       //change org to repo , now juste for test
        // Step 1: Deploy Infrastructure
        //Deploying PROD
        const keyProd = `sites/${deployment.userId}/${deployment.siteName}/terraform.tfstate`
        const infraResult = await this.deployInfrastructure(deployment.userId, deployment.siteName ,deployment.userRepoUrl,keyProd);
    
         //Deploying DEV
        const keyDev = `sites/${deployment.userId}/dev/${deployment.siteName}/terraform.tfstate`
         const devregion = "us-east-1"
         const devTerraformDir = resolve('terraform', 'MediumPlan', 'DEV');
         const infraResult_dev = await this.deployDEVInfrastructure(deployment.userId, deployment.siteName, deployment.userRepoUrl, devTerraformDir,keyDev,devregion);
        // Step 3: Mise à jour de la base de données
        
        // we should add the alb dns 
        deployment.AlbDns = infraResult.albDnsName;
        //dev env
        deployment.clusterName = infraResult.instanceName;
        deployment.instancePublicIp_dev = infraResult_dev.instancePublicIp
        deployment.instanceName_dev = infraResult_dev.instanceName;
        deployment.sshPrivateKey = infraResult_dev.sshkey;
        await this.deploymentRepository.save(deployment);
    
      
    
        return {
         // instancePublicIp: infraResult.instancePublicIp,
          userRepoUrl: githubResult.userRepoUrl,
          //orgRepoUrl: githubResult.orgRepoUrl,
          deploymentId: deployment.id
        };
      } catch (error) {
        console.error('Erreur détaillée:', error);
        throw new Error(`Échec du déploiement: ${error.message}`);
      }
    }
    
    async setupUserDeployment(
       userId: number,
      siteName: string,
      userGithubToken : string 
    ): Promise<{ userRepoUrl: string }> {
      const repoName = `drupal-${siteName}`;
      console.log('token0',userGithubToken)
    
       const user = await this.getUserById(userId);
        console.log('helou',user)
        if (!user || !user.githubToken) {
          throw new Error('User not found or GitHub token missing');
        }
        // Récupérer githubUsername
        const githubUserResponse = await firstValueFrom(
          this.httpService.get('https://api.github.com/user', {
            headers: {
              Authorization: `token ${userGithubToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          })
        );
        const userGithubUsername = githubUserResponse.data.login;
            console.log(userGithubUsername)
    
     
    
    
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `https://api.github.com/repos/${this.orgName}/Medium_Template/generate`,
            {
              owner: userGithubUsername,
              name: repoName,
              private: true,
              include_all_branches: true,
              description: `Drupal site for ${userGithubUsername}'s ${siteName}, with dev and main branches`,
            },
            {
              headers: {
                Authorization: `token ${userGithubToken}`,
                Accept: 'application/vnd.github.baptiste-preview+json', // Required for /generate
              },
            }
          )
        );
        
        const userRepoUrl = response.data.html_url;
    
        console.log(userRepoUrl)
        return {
            userRepoUrl,
          };
        } catch (error) {
          console.error(`Deployment failed: ${error.message}`);
          throw new Error(`Could not complete deployment: ${error.message}`);
        }
      }
    

    private async configureRepoDefaults(repoName: string) {
      await firstValueFrom(
        this.httpService.put(
          `${this.githubApiUrl}/repos/${this.orgName}/${repoName}/branches/main/protection`,
          {
            required_status_checks: null,
            enforce_admins: false,
            required_pull_request_reviews: null,
            restrictions: null,
          },
          { headers: this.getAuthHeaders() },
        ),
      ).catch((error) => console.warn(`Branch protection not set: ${error.message}`));
    }
  
  /*  async addWebhookToUserRepo(userGithubToken: string, userRepo: string) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            `${this.githubApiUrl}/repos/${userRepo}/hooks`,
            {
              name: 'web',
              active: true,
              events: ['push'], // Trigger on push events
              config: {
                url: this.webhookUrl, // e.g., https://your-app/deployment/webhook
                content_type: 'json',
                secret: this.webhookSecret, // Secret to verify webhook payloads
              },
            },
            { headers: this.getUserAuthHeaders(userGithubToken) }
          )
        );
        logger.info(`Webhook added to ${userRepo} with ID ${response.data.id}`);
      } catch (error) {
        logger.error(`Failed to add webhook to ${userRepo}: ${error.response?.data?.message || error.message}`);
        throw new Error(`Webhook setup failed: ${error.message}`);
      }
    }
  */
 /*   verifySignature(signature: string, payload: any): boolean {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      const digest = `sha256=${hmac.update(JSON.stringify(payload)).digest('hex')}`;
      return signature === digest;
    }
  */
    async mirrorRepo(userRepoUrl: string, branch: string, orgRepoName: string) {
      const timestamp = Date.now();
      const localPath = `/tmp/mirror-${timestamp}`;
      const orgRepo = `${this.orgName}/${orgRepoName}`;
      const mirrorUrl = `https://x-access-token:${this.githubToken}@github.com/${orgRepo}.git`;
  
      console.log(`Mirroring to ${orgRepo}`);
  
      try {
        console.log(`[Mirror] Cloning user repo: ${userRepoUrl}`);
        await execAsync(`git clone --branch ${branch} ${userRepoUrl} ${localPath}`);
        console.log(`[Mirror] Setting remote to: ${orgRepo}`);
        await execAsync(`cd ${localPath} && git remote remove origin && git remote add origin ${mirrorUrl}`);
        console.log(`[Mirror] Pushing to org repo...`);
        await execAsync(`cd ${localPath} && git push -f origin ${branch}`);
      } catch (err) {
        console.error('[Mirror Error]', err);
        throw new Error(`Mirroring failed: ${err.message}`);
      } finally {
        await fs.remove(localPath);
      }
    }
  
    async deployInfrastructure(
      userId: number,
      siteName: string,
      githubRepoUrl: string,
      key : string
      ): Promise<{
      //instancePublicIp: string;
      albDnsName: string;
      vpcCidrBlock: string;
      databaseEndpoint: string;
      databasePort: number;
      databaseName: string;
      databaseUsername: string;
      databasePassword: string;
      //dnsRecord: string;
      //wwwDnsRecord: string | null;
      instanceName: string;
      //sshkey: string;
      codebuildProjectArn: string;
    }> {
      const terraformDir = resolve('terraform', 'MediumPlan', 'PROD');
      const tempProfile = `temp-subaccount-${userId}-${siteName}`;
      const workspaceName = `user-${userId}-${siteName}`;
      const env = { ...process.env, AWS_PROFILE: tempProfile };
    
      try {
        logger.info(`🚀 Starting deployment for user ${userId}, site "${siteName}"`);
    
        // 1. Get temporary credentials from user service
     
       const credentials = await this.fetchTempCredentials(userId);
    



       
    
        logger.info(`🪪 AWS creds loaded for ${userId}`);
    
        // 2. Get AWS account ID

        const sts = new AWS.STS({ 
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken, });
        const identity = await sts.getCallerIdentity().promise();
        const accountId = identity.Account;
    
        // 3. Configure AWS CLI profile (sync OK here)
        execSync(`aws configure set aws_access_key_id ${credentials.accessKeyId} --profile ${tempProfile}`);
        execSync(`aws configure set aws_secret_access_key ${credentials.secretAccessKey} --profile ${tempProfile}`);
        execSync(`aws configure set aws_session_token ${credentials.sessionToken} --profile ${tempProfile}`);


           // 7. Terraform apply
        /* await runTerraformCommand([
          'force-unlock -force 1593c0b4-db64-37ef-47e4-1e6585c595c3',
        ], terraformDir, env);
        */
        
        // 4. Run terraform init
        await runTerraformCommand([
          'init',
          `-backend-config=bucket=terraform-state-user`,
          `-backend-config=key=${key}`,
          `-backend-config=region=us-east-1`,
          `-backend-config=dynamodb_table=terraform-locks-user`,
          '-reconfigure'
        ], terraformDir, env);
    
        // 5. Create/select workspace
       /* try {
          await runTerraformCommand(['workspace', 'select', workspaceName], terraformDir, env);
        } catch {
          await runTerraformCommand(['workspace', 'new', workspaceName], terraformDir, env);
        }
  */
        console.log ("ena repo",githubRepoUrl)

             
    
        // 6. Terraform plan
        await runTerraformCommand([
          'plan',
          '-out=plan',
          `-var=user_id=${userId}`,
          `-var=site_name=${siteName}`,
          `-var=account_id=${accountId}`,
          `-var=aws_access_key_id=${credentials.accessKeyId}`,
          `-var=aws_secret_access_key=${credentials.secretAccessKey}`,
          `-var=aws_session_token=${credentials.sessionToken}`,
          `-var=github_repo_url=${githubRepoUrl}`,
         // `-var=docker_image=${dockerImage}`,
        ], terraformDir, env);
    
        // 7. Terraform apply
        await runTerraformCommand([
          'apply',
          '-auto-approve',
          `-var=user_id=${userId}`,
          `-var=site_name=${siteName}`,
          `-var=account_id=${accountId}`,
          `-var=aws_access_key_id=${credentials.accessKeyId}`,
          `-var=aws_secret_access_key=${credentials.secretAccessKey}`,
          `-var=aws_session_token=${credentials.sessionToken}`,
          `-var=github_repo_url=${githubRepoUrl}`
        ], terraformDir, env);

           // 7. Terraform apply
        await runTerraformCommand([
          'state list',    
        ], terraformDir, env);
    
        // 8. Terraform output (sync ok)
        const outputJson = execSync(`terraform output -json`, { cwd: terraformDir, env }).toString();
        const outputs = JSON.parse(outputJson);
    
        // 9. Clean up AWS profile
        const credsPath = join(process.env.USERPROFILE, '.aws', 'credentials');
        if (existsSync(credsPath)) {
          let content = readFileSync(credsPath, 'utf-8');
          content = content.replace(new RegExp(`\\[${tempProfile}\\][\\s\\S]*?(?=\\[|$)`, 'g'), '');
          writeFileSync(credsPath, content.trim());
        }
    
        logger.info(`✅ Deployment completed for user ${userId}, site "${siteName}"`);
  
      
  
    
        return {
          albDnsName: outputs.alb_dns_name.value,
          vpcCidrBlock: outputs.vpc_cidr_block.value,
          databaseEndpoint: outputs.database_endpoint.value,
          databasePort: outputs.database_port.value,
          databaseName: outputs.database_name.value,
          databaseUsername: outputs.database_username.value,
          databasePassword: outputs.database_password.value,
          //dnsRecord: outputs.dns_record.value,
          //wwwDnsRecord: outputs.www_dns_record.value,
          instanceName: outputs.instance_name.value,
          //sshkey: outputs.ssh.value,
          codebuildProjectArn: outputs.codebuild_project_arn.value
        };
    
      } catch (err) {
        logger.error(`❌ Deployment failed for ${userId}/${siteName}: ${err.message}`);
        throw new Error(`Terraform failed: ${err.message}`);
      }
    }

    async deployDEVInfrastructure(
      userId: number,
      siteName: string,
      githubRepoUrl: string,
      terraformDir: string ,// New input parameter,
      key : string ,
      region : string
    ): Promise<{
      instancePublicIp: string;
      databaseEndpoint: string;
      databasePort: number;
      databaseName: string;
      databaseUsername: string;
      databasePassword: string;
      dnsRecord: string;
      wwwDnsRecord: string | null;
      instanceName: string;
      sshkey: string;
      codebuildProjectArn: string;
    }> {
      const tempProfile = `temp-subaccount-${userId}-${siteName}`;
      const workspaceName = `user-${userId}-${siteName}`;
      const env = { ...process.env, AWS_PROFILE: tempProfile };
    
      try {
        logger.info(`🚀 Starting deployment for user ${userId}, site "${siteName}"`);
    
        // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
        logger.info(`🪪 AWS creds loaded for ${userId}`);
    
        // 2. Get AWS account ID
        const sts = new AWS.STS({ accessKeyId, secretAccessKey, sessionToken });
        const identity = await sts.getCallerIdentity().promise();
        const accountId = identity.Account;
  
        if (accountId !== '923159238841') {
          throw new Error(`Expected sub-account ID 923159238841, got ${accountId}`);
        }
        logger.info(`✅ Verified sub-account ID: ${accountId}`);
    
    
        // 3. Configure AWS CLI profile (sync OK here)
        execSync(`aws configure set aws_access_key_id ${accessKeyId} --profile ${tempProfile}`);
        execSync(`aws configure set aws_secret_access_key ${secretAccessKey} --profile ${tempProfile}`);
        execSync(`aws configure set aws_session_token ${sessionToken} --profile ${tempProfile}`);
    
        // 4. Run terraform init
        await runTerraformCommand([
          'init',
          `-backend-config=bucket=terraform-state-user`,
          `-backend-config=key=${key}`,
          `-backend-config=region=${region}`,
          `-backend-config=dynamodb_table=terraform-locks-user`,
          '-reconfigure'
        ], terraformDir, env);
    
        // 5. Create/select workspace
       /* try {
          await runTerraformCommand(['workspace', 'select', workspaceName], terraformDir, env);
        } catch {
          await runTerraformCommand(['workspace', 'new', workspaceName], terraformDir, env);
        }
  */
        console.log ("ena repo",githubRepoUrl)
    
        // 6. Terraform plan
        await runTerraformCommand([
          'plan',
          '-out=plan',
          `-var=user_id=${userId}`,
          `-var=site_name=${siteName}`,
          `-var=account_id=${accountId}`,
          `-var=aws_access_key_id=${accessKeyId}`,
          `-var=aws_secret_access_key=${secretAccessKey}`,
          `-var=aws_session_token=${sessionToken}`,
          `-var=github_repo_url=${githubRepoUrl}`,
         // `-var=docker_image=${dockerImage}`,
        ], terraformDir, env);
    
        // 7. Terraform apply
        await runTerraformCommand([
          'apply',
          '-auto-approve',
          `-var=user_id=${userId}`,
          `-var=site_name=${siteName}`,
          `-var=account_id=${accountId}`,
          `-var=aws_access_key_id=${accessKeyId}`,
          `-var=aws_secret_access_key=${secretAccessKey}`,
          `-var=aws_session_token=${sessionToken}`,
          `-var=github_repo_url=${githubRepoUrl}`
        ], terraformDir, env);
    
        // 8. Terraform output (sync ok)
        const outputJson = execSync(`terraform output -json`, { cwd: terraformDir, env }).toString();
        const outputs = JSON.parse(outputJson);
    
        // 9. Clean up AWS profile
        const credsPath = join(process.env.USERPROFILE, '.aws', 'credentials');
        if (existsSync(credsPath)) {
          let content = readFileSync(credsPath, 'utf-8');
          content = content.replace(new RegExp(`\\[${tempProfile}\\][\\s\\S]*?(?=\\[|$)`, 'g'), '');
          writeFileSync(credsPath, content.trim());
        }
    
        logger.info(`✅ Deployment completed for user ${userId}, site "${siteName}"`);
  
      
  
    
        return {
          instancePublicIp: outputs.instance_public_ip.value,
          databaseEndpoint: outputs.database_endpoint.value,
          databasePort: outputs.database_port.value,
          databaseName: outputs.database_name.value,
          databaseUsername: outputs.database_username.value,
          databasePassword: outputs.database_password.value,
          dnsRecord: outputs.dns_record.value,
          wwwDnsRecord: outputs.www_dns_record.value,
          instanceName: outputs.instance_name.value,
          sshkey: outputs.ssh.value,
          codebuildProjectArn: outputs.codebuild_project_arn.value
        };
    
      } catch (err) {
        logger.error(`❌ Deployment failed for ${userId}/${siteName}: ${err.message}`);
        throw new Error(`Terraform failed: ${err.message}`);
      }
    }
  
  
      

    async deployInfrastructure1(
      userId: number,
      siteName: string,
    ): Promise<{
      albDnsName: string;
      vpcCidrBlock: string;
      databaseEndpoint: string;
      databasePort: number;
      databaseName: string;
      databaseUsername: string;
      databasePassword: string;
      dnsRecord: string;
      wwwDnsRecord: string;
      instanceName: string;      
    }> {
      try {
        logger.info(`Starting infrastructure deployment for user_id ${userId}, site_name ${siteName}`);
    
        // Step 1: Get temporary credentials from user-service
         // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

        const { accessKeyId, secretAccessKey, sessionToken } = data;
    
        logger.info(`Temporary Credentials: aws_access_key_id=${accessKeyId}, aws_secret_access_key=${secretAccessKey}, aws_session_token=${sessionToken}`);
    
        // Step 2: Use the temporary credentials to get the account ID
        const sts = new AWS.STS({
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
          sessionToken: sessionToken,
        });
    
        const identity = await sts.getCallerIdentity().promise();
        const awsRegion = "us-east-1";
        const accountId = identity.Account;
        logger.info(`Deploying to sub-account with Account ID: ${accountId}, Arn: ${identity.Arn}`);
    
        // Step 3: Create a temporary AWS CLI profile for the sub-account credentials
        const tempProfile = `temp-subaccount-${userId}-${siteName}`; // Unique profile name to avoid conflicts
        execSync(`aws configure set aws_access_key_id ${accessKeyId} --profile ${tempProfile}`, { stdio: 'inherit' });
        execSync(`aws configure set aws_secret_access_key ${secretAccessKey} --profile ${tempProfile}`, { stdio: 'inherit' });
        execSync(`aws configure set aws_session_token ${sessionToken} --profile ${tempProfile}`, { stdio: 'inherit' });
        logger.info(`Created temporary AWS CLI profile: ${tempProfile}`);
    
        // Step 4: Set up Terraform execution directory
        const terraformDir = path.resolve('terraform', 'MediumPlan', 'PROD');
        logger.info(`Changed working directory to ${terraformDir}`);
        const env = { ...process.env, AWS_PROFILE: tempProfile };
    
        // Run terraform init with S3 backend configuration
        try {
          execSync(
            `terraform init -backend-config="bucket=terraform-state-user" -backend-config="key=sites/${userId}/${siteName}/terraform.tfstate" -backend-config="region=us-east-1" -backend-config="dynamodb_table=terraform-locks-user" -reconfigure`,
            { cwd: terraformDir, stdio: 'inherit', env }
          );
          logger.info('Terraform init completed successfully');
        } catch (error) {
          logger.error('Terraform init failed:', error.message);
          throw error;
        }
    
        // Run terraform plan
        const planCommand = `terraform plan -out=plan -var="user_id=${userId}" -var="site_name=${siteName}" -var="account_id=${accountId}" -var="aws_access_key_id=${accessKeyId}" -var="aws_secret_access_key=${secretAccessKey}" -var="aws_session_token=${sessionToken}"`;
        execSync(planCommand, { cwd: terraformDir, stdio: 'inherit', env });
    
        // Run terraform apply
        const applyCommand = `terraform apply -auto-approve -var="user_id=${userId}" -var="site_name=${siteName}" -var="account_id=${accountId}" -var="aws_access_key_id=${accessKeyId}" -var="aws_secret_access_key=${secretAccessKey}" -var="aws_session_token=${sessionToken}"`;
        execSync(applyCommand, { cwd: terraformDir, stdio: 'inherit', env });
    
        // Step 5: Fetch Terraform outputs
        const outputJson = execSync(`terraform output -json`, { cwd: terraformDir, env }).toString();
        const outputs = JSON.parse(outputJson);
    
        // Step 6: Clean up the temporary profile
        const awsCredentialsPath = path.join(process.env.USERPROFILE, '.aws', 'credentials');
        if (fs.existsSync(awsCredentialsPath)) {
          let credentialsContent = fs.readFileSync(awsCredentialsPath, 'utf-8');
          credentialsContent = credentialsContent.replace(new RegExp(`\\[${tempProfile}\\][\\s\\S]*?(?=\\[|$)`, 'g'), '');
          fs.writeFileSync(awsCredentialsPath, credentialsContent.trim());
          logger.info(`Removed temporary AWS CLI profile: ${tempProfile}`);
        }
    
        // Step 7: Return the outputs
        return {
          albDnsName: outputs.alb_dns_name.value,
          vpcCidrBlock: outputs.vpc_cidr_block.value,
          databaseEndpoint: outputs.database_endpoint.value,
          databasePort: outputs.database_port.value,
          databaseName: outputs.database_name.value,
          databaseUsername: outputs.database_username.value,
          databasePassword: outputs.database_password.value,
          dnsRecord: outputs.dns_record.value,
          wwwDnsRecord: outputs.www_dns_record.value,
          instanceName: outputs.instance_name.value,
        };
      } catch (error) {
        logger.error(`Failed to deploy infrastructure for user_id ${userId}, site_name ${siteName}: ${error.message}`);
        throw new Error(`Failed to deploy infrastructure: ${error.message}`);
      }
    }


  
    async  destroyPRODInfrastructure(userId: number, siteName: string, deploymentId: number, terraformDir : string , key : string): Promise<void> {
      let secretsManagerClient: SecretsManagerClient | undefined;
      const workspaceName = `user-${userId}-${siteName}`;
      const tempProfile = `temp-subaccount-${userId}-${siteName}`;
      const env = { ...process.env, AWS_PROFILE: tempProfile };
    
      try {
        logger.info(`Starting destruction for user_id ${userId}, site_name ${siteName}, deployment_id ${deploymentId}`);
    
        // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
        logger.info(`Credentials: aws_access_key_id=${accessKeyId}`);
    
        // Step 2: Verify credentials
        const sts = new AWS.STS({ accessKeyId, secretAccessKey, sessionToken });
        const identity = await sts.getCallerIdentity().promise();
        const accountId = identity.Account;
        logger.info(`Destroying in sub-account: Account ID=${accountId}, Arn=${identity.Arn}`);
    
        // Step 3: Initialize SecretsManagerClient and LightsailClient
        secretsManagerClient = new SecretsManagerClient({
          region: 'us-east-1',
          credentials: { accessKeyId, secretAccessKey, sessionToken },
        });

  const autoScalingClient = new AutoScalingClient({
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey, sessionToken },
    });
    const ec2Client = new EC2Client({
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey, sessionToken },
    });
    const ecsClient = new ECSClient({
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey, sessionToken },
    });

    // Step 4: Scale down and delete ASG
    const asgName = `asg-${siteName}`;
    try {
      console.log(`Scaling down ASG ${asgName} to zero...`);
      await autoScalingClient.send(
        new UpdateAutoScalingGroupCommand({
          AutoScalingGroupName: asgName,
          MinSize: 0,
          MaxSize: 0,
          DesiredCapacity: 0,
        }),
      );
      console.log("Waiting 60 seconds for ASG ${asgName} to terminate instances...");
      await new Promise((resolve) => setTimeout(resolve, 60000));
      console.log("ASG ${asgName} scaled down successfully.");

      console.log(`Deleting ASG ${asgName}...`);
      await autoScalingClient.send(
        new DeleteAutoScalingGroupCommand({
          AutoScalingGroupName: asgName,
          ForceDelete: true,
        }),
      );
      console.log(`ASG ${asgName} deleted successfully.`);
    } catch (error) {
      logger.warn(`Failed to scale down/delete ASG ${asgName}: ${error.message}. Proceeding.`);
    }

    // Step 5: Deregister container instances and terminate orphaned EC2 instances
        const clusterName = `ecs-cluster-${siteName}`;

    try {
      console.log(`Checking for ECS container instances...`);
      const containerInstances = await ecsClient.send(
        new ListContainerInstancesCommand({ cluster: clusterName }),
      );
      for (const instanceArn of containerInstances.containerInstanceArns || []) {
        console.log(`Deregistering container instance ${instanceArn}...`);
        await ecsClient.send(
          new DeregisterContainerInstanceCommand({
            cluster: clusterName,
            containerInstance: instanceArn,
            force: true,
          }),
        );
      }
     console.log("Container instances deregistered.");

      console.log(`Checking for orphaned EC2 instances...`);
      const describeResponse = await ec2Client.send(
        new DescribeInstancesCommand({
          Filters: [{ Name: 'tag:AmazonECSManaged', Values: ['true'] }],
        }),
      );
      const instanceIds = describeResponse.Reservations?.flatMap((r) =>
        r.Instances?.map((i) => i.InstanceId).filter((id): id is string => !!id),
      ) || [];
      if (instanceIds.length > 0) {
        console.log(`Terminating orphaned instances: ${instanceIds.join(', ')}`);
        await ec2Client.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }));
        console.log(`Waiting 60 seconds for instances to terminate...`);
        await new Promise((resolve) => setTimeout(resolve, 60000));
        console.log(`Orphaned instances terminated.`);
      } else {
        console.log(`No orphaned EC2 instances found.`);
      }
    } catch (error) {
      logger.warn(`Failed to deregister/terminate instances: ${error.message}. Proceeding.`);
    }

   // Step 6: Stop tasks and delete ECS service
    const serviceName = `medium-tier-service-${siteName}`;
    try {
      console.log(`Checking ECS service ${serviceName} status...`);
      const serviceResponse = await ecsClient.send(
        new DescribeServicesCommand({
          cluster: clusterName,
          services: [serviceName],
        }),
      );
      const service = serviceResponse.services?.[0];
      if (service && service.status === 'ACTIVE') {
        // Stop all running tasks
       console.log(`Stopping running tasks for service ${serviceName}...`);
        const tasks = await ecsClient.send(
          new ListTasksCommand({
            cluster: clusterName,
            serviceName: serviceName,
          }),
        );
        for (const taskArn of tasks.taskArns || []) {
          console.log(`Stopping task ${taskArn}...`);
          await ecsClient.send(
            new StopTaskCommand({
              cluster: clusterName,
              task: taskArn,
              reason: 'Force stop for service deletion',
            }),
          );
        }
        console.log(`Waiting 120 seconds for tasks to stop...`);
        await new Promise((resolve) => setTimeout(resolve, 120000));

        // Update service with forceNewDeployment
        console.log(`Scaling down ECS service ${serviceName} to desired count 0...`);
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            await ecsClient.send(
              new UpdateServiceCommand({
                cluster: clusterName,
                service: serviceName,
                desiredCount: 0,
                capacityProviderStrategy: [],
                forceNewDeployment: true,
              }),
            );
            console.log(`ECS service ${serviceName} scaled down successfully.`);
            break;
          } catch (updateError) {
            attempts++;
            if (attempts === maxAttempts) {
              throw updateError;
            }
            logger.warn(`Attempt ${attempts} to update ECS service ${serviceName} failed: ${updateError.message}. Retrying in 60 seconds...`);
            await new Promise((resolve) => setTimeout(resolve, 60000));
          }
        }
        console.log(`Waiting 120 Seconds for ECS service ${serviceName} to stabilize...`);
        await new Promise((resolve) => setTimeout(resolve, 120000));

        // Retry service deletion
        console.log(`Deleting ECS service ${serviceName}...`);
        attempts = 0;
        while (attempts < maxAttempts) {
          try {
            await ecsClient.send(
              new DeleteServiceCommand({
                cluster: clusterName,
                service: serviceName,
                force: true,
              }),
            );
            console.log(`ECS service ${serviceName} deleted successfully.`);
            break;
          } catch (deleteError) {
            attempts++;
            if (attempts === maxAttempts) {
              throw deleteError;
            }
            logger.warn(`Attempt ${attempts} to delete ECS service ${serviceName} failed: ${deleteError.message}. Retrying in 60 seconds...`);
            await new Promise((resolve) => setTimeout(resolve, 60000));
          }
        }
      } else {
        console.log(`ECS service ${serviceName} is not active or does not exist. Skipping.`);
      }
    } catch (error) {
      logger.warn(`Failed to stop tasks/scale down/delete ECS service ${serviceName}: ${error.message}. Proceeding.`);
    }
    // Step 7: Remove and delete Capacity Provider
    const capacityProvider = `capacity-${siteName}`;
    try {
      console.log({ message: `Removing Capacity Provider ${capacityProvider} from cluster...` });
      await ecsClient.send(
        new PutClusterCapacityProvidersCommand({
          cluster: clusterName,
          capacityProviders: [],
          defaultCapacityProviderStrategy: [],
        }),
      );
      console.log(`Capacity Provider ${capacityProvider} removed from cluster.`);

      console.log(`Deleting Capacity Provider ${capacityProvider}...`);
      await ecsClient.send(
        new DeleteCapacityProviderCommand({
          capacityProvider: capacityProvider,
        }),
      );
      console.log(`Capacity Provider ${capacityProvider} deleted successfully.`);
    } catch (error) {
      console.warn(`Failed to remove/delete Capacity Provider ${capacityProvider}: ${error.message}. Proceeding.`);
    }
    // Step 7.5: Stop any remaining running ECS tasks not associated with a service
try {
  console.log(`Listing all running tasks in ECS cluster ${clusterName}...`);
  const runningTasks = await ecsClient.send(
    new ListTasksCommand({
      cluster: clusterName,
      desiredStatus: "RUNNING",
    }),
  );

  if (runningTasks.taskArns && runningTasks.taskArns.length > 0) {
    console.log(`Found ${runningTasks.taskArns.length} running tasks. Stopping them...`);
    for (const taskArn of runningTasks.taskArns) {
      console.log(`Stopping standalone task ${taskArn}...`);
      await ecsClient.send(
        new StopTaskCommand({
          cluster: clusterName,
          task: taskArn,
          reason: "Cleanup before ECS cluster deletion",
        }),
      );
    }

    console.log("Waiting 60 seconds for all tasks to stop...");
    await new Promise((resolve) => setTimeout(resolve, 60000));
  } else {
    console.log("No standalone running ECS tasks found.");
  }
} catch (error) {
  logger.warn(`Failed to stop standalone running tasks: ${error.message}. Proceeding.`);
}

    // Step 8: Delete ECS cluster
    // Step 8: Delete ECS cluster
try {
  console.log(`Checking for active tasks in ECS cluster ${clusterName}...`);
  const tasks = await ecsClient.send(
    new ListTasksCommand({
      cluster: clusterName,
    }),
  );

  if (tasks.taskArns && tasks.taskArns.length > 0) {
    logger.warn(
      `Failed to delete ECS cluster ${clusterName}: The Cluster cannot be deleted while Tasks are active (${tasks.taskArns.length} active). Proceeding.`,
    );
  } else {
    console.log(`No active tasks found. Deleting ECS cluster ${clusterName}...`);
    await ecsClient.send(
      new DeleteClusterCommand({
        cluster: clusterName,
      }),
    );
    console.log(`ECS cluster ${clusterName} deleted successfully.`);
  }
} catch (error) {
  logger.warn(`Failed to delete ECS cluster ${clusterName}: ${error.message}. Proceeding.`);
}



    
        
        // Step 5: Set temporary AWS CLI profile
        execSync(`aws configure set aws_access_key_id ${accessKeyId} --profile ${tempProfile}`);
        execSync(`aws configure set aws_secret_access_key ${secretAccessKey} --profile ${tempProfile}`);
        execSync(`aws configure set aws_session_token ${sessionToken} --profile ${tempProfile}`);
        execSync(`aws configure set region us-east-1 --profile ${tempProfile}`);
        logger.info(`Created profile: ${tempProfile}`);
    
        // Step 8: Initialize Terraform with lock check
        logger.info(`Initializing Terraform in ${terraformDir}...`);
       // await checkAndClearTerraformLock(terraformDir, env, statePath);
         // 7. Terraform apply
   /* await runTerraformCommand([
          'force-unlock -force  54011f25-8384-2e40-afc4-39d7b24c5c7f',

        ], terraformDir, env);
    */   
        try {
          await runTerraformCommand([
            'init',
            '-reconfigure',
            '-backend-config=bucket=terraform-state-user',
            `-backend-config=key=${key}`,
            '-backend-config=region=us-east-1',
            '-backend-config=dynamodb_table=terraform-locks-user'
          ], terraformDir, env);
        } catch (error) {
          logger.error(`Terraform init failed: ${error.message}`);
          throw new Error(`Terraform init failed: ${error.message}`);
        }
    
       
    
        // Step 11: Remove aws_codebuild_source_credential from state
        try {
          const { stdout: stateList } = await execAsync(`terraform state list`, { cwd: terraformDir, env });
          if (stateList.includes('aws_codebuild_source_credential.github')) {
            logger.info(`Removing aws_codebuild_source_credential.github from state...`);
            await execAsync(`terraform state rm aws_codebuild_source_credential.github`, { cwd: terraformDir, env });
            logger.info(`Successfully removed aws_codebuild_source_credential.github.`);
          } else {
            logger.info(`aws_codebuild_source_credential.github not found in state.`);
          }
        } catch (error) {
          logger.warn(`Failed to remove aws_codebuild_source_credential: ${error.message}. Proceeding...`);
        }
    
        // Step 12: Run Terraform destroy
        const deployment = await this.findOne(deploymentId);
        const github_repo_url = deployment.orgRepoUrl;

         
            const destroyCommands = [
            'destroy',
            '-auto-approve',
            `-var=user_id=${userId}`,
            `-var=site_name=${siteName}`,
            `-var=account_id=${accountId}`,
            `-var=aws_access_key_id=${accessKeyId}`,
            `-var=aws_secret_access_key=${secretAccessKey}`,
            `-var=aws_session_token=${sessionToken}`,
            `-var=github_repo_url=${github_repo_url}`
        ]

        const region = "us-east-1"
     


          try {
                await runTerraformCommand(destroyCommands, terraformDir, env);
                logger.info('Terraform destroy successful');
              } catch (error) {
                const errorMessage = error.message || error.stderr || '';
                const lockIdMatch = errorMessage.match(/ID:\s*([a-f0-9-]+)\s/);
                console.log(lockIdMatch)
                if (lockIdMatch && lockIdMatch[1]) {
                  const lockId = lockIdMatch[1];
                  logger.info(`Detected lock ID: ${lockId}`);
                  try {
                    await runTerraformCommand(['force-unlock', '-force', lockId], terraformDir, env);
                    logger.info('Terraform state unlocked');
                    await runTerraformCommand(destroyCommands, terraformDir, env);
                    logger.info('Terraform destroy successful after unlock');
                  } catch (unlockError) {
                    logger.error(`Force-unlock failed: ${unlockError.message}`);
                    logger.info('Attempting to delete lock from DynamoDB...');
                    const dynamodb = new AWS.DynamoDB({ region, credentials: { accessKeyId, secretAccessKey, sessionToken } });
                    try {
                      await dynamodb
                        .deleteItem({
                          TableName: 'terraform-locks-user',
                          Key: { LockID: { S: lockId } },
                        })
                        .promise();
                      logger.info('DynamoDB lock deleted');
                      await runTerraformCommand(destroyCommands, terraformDir, env);
                      logger.info('Terraform destroy successful after DynamoDB unlock');
                    } catch (dynamoError) {
                      logger.error(`DynamoDB unlock failed: ${dynamoError.message}`);
                      logger.info('Falling back to -lock=false...');
                      await runTerraformCommand([...destroyCommands, '-lock=false'], terraformDir, env);
                      logger.info('Terraform destroy successful with -lock=false');
                    }
                  }
                } else {
                  logger.info('No lock ID found, falling back to -lock=false...');
                  await runTerraformCommand([...destroyCommands, '-lock=false'], terraformDir, env);
                  logger.info('Terraform destroy successful with -lock=false');
                }
              }
   
    
        // Step 13: Clean up Secrets Manager secrets
        await this.cleanupScheduledSecrets(userId, siteName);
    
        // Step 14: Clean up profile
        const awsCredentialsPath = path.join(process.env.USERPROFILE, '.aws', 'credentials');
        if (fs.existsSync(awsCredentialsPath)) {
          let credentialsContent = fs.readFileSync(awsCredentialsPath, 'utf-8');
          credentialsContent = credentialsContent.replace(new RegExp(`\\[${tempProfile}\\][\\s\\S]*?(?=\\[|$)`, 'g'), '');
          fs.writeFileSync(awsCredentialsPath, credentialsContent.trim());
          logger.info(`Removed profile: ${tempProfile}`);
        }
    
        // Step 15: Delete GitHub repositories
     //   await this.deleteGitHubRepositories(userId, siteName);
    
        // Step 16: Delete Cloudflare DNS record
        const cloudflareDomain = deployment.cloudflareDomain;
        if (cloudflareDomain) {
          // await this.deleteCloudflareDNSRecord(cloudflareDomain);
        }
    
        // Step 17: Delete from database
        // await this.deleteDeployment(deploymentId);
        logger.info(`Deleted deployment ${deploymentId} from database`);
      } catch (error) {
        logger.error(`Failed to destroy: ${error.message}`);
        throw new Error(`Failed to destroy infrastructure: ${error.message}`);
      } finally {
        if (secretsManagerClient) secretsManagerClient.destroy();
      }
    }

    async deleteGitHubRepositories(userId: number, siteName: string): Promise<void> {
      const repoName = `drupal-${userId}-${siteName}`;
      logger.info(`Deleting GitHub repositories for ${repoName}`);
  
      try {
        const user = await this.getUserById(userId);
  
        if (!user || !user.githubToken) {
          throw new Error('User not found or GitHub token missing');
        }
  
        // Delete organization repository
        await firstValueFrom(
          this.httpService.delete(`${this.githubApiUrl}/repos/${this.orgName}/${repoName}`, {
            headers: this.getAuthHeaders(),
          })
        );
        logger.info(`Deleted organization repository: ${this.orgName}/${repoName}`);
      } catch (error) {
        if (error.response?.status === 404) {
          logger.warn(`Repository ${repoName} not found, skipping deletion`);
        } else {
          logger.error(`Failed to delete GitHub repositories: ${error.message}`);
          throw error;
        }
      }

    }



    async  destroyDEVInfrastructure(userId: number, siteName: string, deploymentId: number, terraformDir : string , key : string): Promise<void> {
      let secretsManagerClient: SecretsManagerClient | undefined;
      const workspaceName = `user-${userId}-${siteName}`;
      const tempProfile = `temp-subaccount-${userId}-${siteName}`;
      const env = { ...process.env, AWS_PROFILE: tempProfile};
    
      try {
        logger.info(`Starting destruction for user_id ${userId}, site_name ${siteName}, deployment_id ${deploymentId}`);
    
        // Step 1: Get temporary credentials
        /*const response: AxiosResponse<AwsCredentialsResponse> = await firstValueFrom(
          this.httpService.post<AwsCredentialsResponse>(`http://localhost:3030/user/${userId}/connect-aws`, {}),
        );
        const { accessKeyId, secretAccessKey, sessionToken } = response.data;*/
         // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
        logger.info(`Credentials: aws_access_key_id=${accessKeyId}`);
    
        // Step 2: Verify credentials
        const sts = new AWS.STS({ accessKeyId, secretAccessKey, sessionToken });
        const identity = await sts.getCallerIdentity().promise();
        const accountId = identity.Account;
        logger.info(`Destroying in sub-account: Account ID=${accountId}, Arn=${identity.Arn}`);
    
        // Step 3: Initialize SecretsManagerClient and LightsailClient
        secretsManagerClient = new SecretsManagerClient({
          region: 'us-east-1',
          credentials: { accessKeyId, secretAccessKey, sessionToken },
        });

        // Step 5: Set temporary AWS CLI profile
        execSync(`aws configure set aws_access_key_id ${accessKeyId} --profile ${tempProfile}`);
        execSync(`aws configure set aws_secret_access_key ${secretAccessKey} --profile ${tempProfile}`);
        execSync(`aws configure set aws_session_token ${sessionToken} --profile ${tempProfile}`);
        execSync(`aws configure set region us-east-1 --profile ${tempProfile}`);
        logger.info(`Created profile: ${tempProfile}`);

       
    
        // Step 8: Initialize Terraform with lock check
        logger.info(`Initializing Terraform in ${terraformDir}...`);
        try {
          await runTerraformCommand([
            'init',
            '-reconfigure',
            '-backend-config=bucket=terraform-state-user',
            `-backend-config=key=${key}`,
            '-backend-config=region=us-east-1',
            '-backend-config=dynamodb_table=terraform-locks-user'
          ], terraformDir, env);
        } catch (error) {
          logger.error(`Terraform init failed: ${error.message}`);
          throw new Error(`Terraform init failed: ${error.message}`);
        }
    
        // Step 11: Remove aws_codebuild_source_credential from state
        try {
          const { stdout: stateList } = await execAsync(`terraform state list`, { cwd: terraformDir, env });
          if (stateList.includes('aws_codebuild_source_credential.github')) {
            logger.info(`Removing aws_codebuild_source_credential.github from state...`);
            await execAsync(`terraform state rm aws_codebuild_source_credential.github`, { cwd: terraformDir, env });
            logger.info(`Successfully removed aws_codebuild_source_credential.github.`);
          } else {
            logger.info(`aws_codebuild_source_credential.github not found in state.`);
          }
        } catch (error) {
          logger.warn(`Failed to remove aws_codebuild_source_credential: ${error.message}. Proceeding...`);
        }
        // Step 12: Run Terraform destroy
        const deployment = await this.findOne(deploymentId);
        const github_repo_url = deployment.orgRepoUrl;
      

        const destroyCommands = [
            'destroy',
            '-auto-approve',
            `-var=user_id=${userId}`,
            `-var=site_name=${siteName}`,
            `-var=account_id=${accountId}`,
            `-var=aws_access_key_id=${accessKeyId}`,
            `-var=aws_secret_access_key=${secretAccessKey}`,
            `-var=aws_session_token=${sessionToken}`,
            `-var=github_repo_url=${github_repo_url}`
        ]
    
        const region = "us-east-1"

         try {
                await runTerraformCommand(destroyCommands, terraformDir, env);
                logger.info('Terraform destroy successful');
              } catch (error) {
                const errorMessage = error.message || error.stderr || '';
                const lockIdMatch = errorMessage.match(/ID:\s*([a-f0-9-]+)\s/);
                if (lockIdMatch && lockIdMatch[1]) {
                  const lockId = lockIdMatch[1];
                  logger.info(`Detected lock ID: ${lockId}`);
                  try {
                    await runTerraformCommand(['force-unlock', '-force', lockId], terraformDir, env);
                    logger.info('Terraform state unlocked');
                    await runTerraformCommand(destroyCommands, terraformDir, env);
                    logger.info('Terraform destroy successful after unlock');
                  } catch (unlockError) {
                    logger.error(`Force-unlock failed: ${unlockError.message}`);
                    logger.info('Attempting to delete lock from DynamoDB...');
                    const dynamodb = new AWS.DynamoDB({ region, credentials: { accessKeyId, secretAccessKey, sessionToken } });
                    try {
                      await dynamodb
                        .deleteItem({
                          TableName: 'terraform-locks-user',
                          Key: { LockID: { S: lockId } },
                        })
                        .promise();
                      logger.info('DynamoDB lock deleted');
                      await runTerraformCommand(destroyCommands, terraformDir, env);
                      logger.info('Terraform destroy successful after DynamoDB unlock');
                    } catch (dynamoError) {
                      logger.error(`DynamoDB unlock failed: ${dynamoError.message}`);
                      logger.info('Falling back to -lock=false...');
                      await runTerraformCommand([...destroyCommands, '-lock=false'], terraformDir, env);
                      logger.info('Terraform destroy successful with -lock=false');
                    }
                  }
                } else {
                  logger.info('No lock ID found, falling back to -lock=false...');
                  await runTerraformCommand([...destroyCommands, '-lock=false'], terraformDir, env);
                  logger.info('Terraform destroy successful with -lock=false');
                }
              }
        // Step 13: Clean up Secrets Manager secrets
        await this.cleanupScheduledSecrets(userId, siteName);
    
        // Step 14: Clean up profile
        const awsCredentialsPath = path.join(process.env.USERPROFILE, '.aws', 'credentials');
        if (fs.existsSync(awsCredentialsPath)) {
          let credentialsContent = fs.readFileSync(awsCredentialsPath, 'utf-8');
          credentialsContent = credentialsContent.replace(new RegExp(`\\[${tempProfile}\\][\\s\\S]*?(?=\\[|$)`, 'g'), '');
          fs.writeFileSync(awsCredentialsPath, credentialsContent.trim());
          logger.info(`Removed profile: ${tempProfile}`);
        }
    
        // Step 15: Delete GitHub repositories
        ///await this.deleteGitHubRepositories(userId, siteName);
    
        // Step 16: Delete Cloudflare DNS record
        const cloudflareDomain = deployment.cloudflareDomain;
        if (cloudflareDomain) {
          // await this.deleteCloudflareDNSRecord(cloudflareDomain);
        }
    
        // Step 17: Delete from database
        // await this.deleteDeployment(deploymentId);
        logger.info(`Deleted deployment ${deploymentId} from database`);
      } catch (error) {
        logger.error(`Failed to destroy: ${error.message}`);
        throw new Error(`Failed to destroy infrastructure: ${error.message}`);
      } finally {
        if (secretsManagerClient) secretsManagerClient.destroy();
      }
    }
  
    
    

    async cleanupScheduledSecrets(userId: number, siteName: string): Promise<void> {
      const secretsManager = new AWS.SecretsManager({
        region: 'us-east-1',
      });
  
      const secretNames = [
        `sites/${userId}/${siteName}`,
        `ssh/${userId}/${siteName}`,
      ];
  
      for (const secretName of secretNames) {
        try {
          const secret = await secretsManager.describeSecret({ SecretId: secretName }).promise();
          if (secret.DeletedDate) {
           console.log('Secret ${secretName} is scheduled for deletion. Forcing deletion...');
            await secretsManager.deleteSecret({
              SecretId: secretName,
              ForceDeleteWithoutRecovery: true,
            }).promise();
           console.log(`Secret ${secretName} has been permanently deleted.`);
          } else {
            console.log(`Deleting secret ${secretName}...`);
            await secretsManager.deleteSecret({
              SecretId: secretName,
              ForceDeleteWithoutRecovery: true,
            }).promise();
            console.log(`Secret ${secretName} has been permanently deleted.`);
          }
        } catch (error) {
          if (error.code === 'ResourceNotFoundException') {
            console.log(`Secret ${secretName} does not exist. Proceeding...`);
          } else {
            logger.error(`Error managing secret ${secretName}: ${error.message}`);
            throw error;
          }
        }
      }
    }
      
  



      async destroyInfrastructure1(userId: number,  siteName: string): Promise<void> {

      //  const deployment = await this.findOne(deploymentId);
        //const cloudflareDomain = deployment.cloudflareDomain;
        try {
          logger.info(`Starting destruction for user_id ${userId},  site_name ${siteName}`);
      
       // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
          logger.info(`Credentials: aws_access_key_id=${accessKeyId}`);
      
          // Step 2: Verify credentials
          const sts = new AWS.STS({ accessKeyId, secretAccessKey, sessionToken });
          const identity = await sts.getCallerIdentity().promise();
          const accountId = identity.Account;
          logger.info(`Destroying in sub-account: Account ID=${accountId}, Arn=${identity.Arn}`);
      
          // Step 3: Set temporary AWS CLI profile
          const tempProfile = `temp-subaccount-${userId}-${siteName}`;
          execSync(`aws configure set aws_access_key_id ${accessKeyId} --profile ${tempProfile}`);
          execSync(`aws configure set aws_secret_access_key ${secretAccessKey} --profile ${tempProfile}`);
          execSync(`aws configure set aws_session_token ${sessionToken} --profile ${tempProfile}`);
          execSync(`aws configure set region us-east-1 --profile ${tempProfile}`);
          logger.info(`Created profile: ${tempProfile}`);
      
          // Step 4: Run Terraform destroy
          const terraformDir = path.join('terraform', 'MediumPlan', 'PROD');
          logger.info(`Terraform directory: ${terraformDir}`);
          const env = { ...process.env, AWS_PROFILE: tempProfile };
      
          try {
            execSync(`terraform init`, { cwd: terraformDir, env, stdio: 'inherit' });
            execSync(`terraform destroy -auto-approve -var="user_id=${userId}" -var="site_name=${siteName}" -var="account_id=${accountId}"  -var="aws_access_key_id=${accessKeyId}" -var="aws_secret_access_key=${secretAccessKey}" -var="aws_session_token=${sessionToken}"`, { cwd: terraformDir, env, stdio: 'inherit'});
            logger.info(`Destroyed infrastructure`);
          } catch (terraformError) {
            logger.error(`Terraform error: ${terraformError.message}`);
            throw terraformError;
          }
    
    
        //  await this.cleanupScheduledSecrets(userId, siteName);
      
          // Step 5: Clean up profile
          const awsCredentialsPath = path.join(process.env.USERPROFILE, '.aws', 'credentials');
          if (fs.existsSync(awsCredentialsPath)) {
            let credentialsContent = fs.readFileSync(awsCredentialsPath, 'utf-8');
            credentialsContent = credentialsContent.replace(new RegExp(`\\[${tempProfile}\\][\\s\\S]*?(?=\\[|$)`, 'g'), '');
            fs.writeFileSync(awsCredentialsPath, credentialsContent.trim());
            logger.info(`Removed profile: ${tempProfile}`);
          }
    
          // Step 8: Delete GitHub repositories
         // await this.deleteGitHubRepositories(userId, siteName);

    
          //delete from database
        } catch (error) {
          logger.error(`Failed to destroy: ${error.message}`);
          throw new Error(`Failed to destroy infrastructure: ${error.message}`);
        }
      }


      

//delete the website
async deleteSite(deploymentId: number): Promise<void> {
  const deployment = await this.findOne(deploymentId);
  //siteName should be saved in the db (cas upgrade to be updated )
  //disk name also
  //il faut voir comment ca se passe ! 
  const { userId, siteName } = deployment;
  console.log ("ena deployment of deletesite function ",deployment)

  try {


    const terraformDirDEV = path.join('terraform', 'MediumPlan', 'DEV');
    const keyDev = `sites/${deployment.userId}/dev/${deployment.siteName}/terraform.tfstate`

    await this.destroyDEVInfrastructure(userId, siteName, deploymentId,terraformDirDEV,keyDev);
    

    const terraformDirPROD = path.join('terraform', 'MediumPlan', 'PROD');
    const keyProd = `sites/${deployment.userId}/${deployment.siteName}/terraform.tfstate`

    await this.destroyPRODInfrastructure(userId, siteName, deploymentId,terraformDirPROD,keyProd);

    //we will check github token permissions to delete the github repo 
    //await this.cleanupScheduledSecrets(userId, siteName);
    // add destroy infra dev

    await this.deploymentRepository.delete(deploymentId);
    console.log(`Successfully deleted deployment ${deploymentId} for user ${userId}, site ${siteName}`);
  } catch (error) {
    console.error(`Failed to delete deployment ${deploymentId}: ${error.message}`);
    throw new Error(`Failed to delete site: ${error.message}`);
  }
}


async findOne(id: number) {
  return await this.deploymentRepository.findOneBy({ id: id });
}


///////////////////////////////GITHUB TOKEN FUNCTIONS  : PAT for Codebuild & user repo ) 
async saveGitHubPat(userId: number, pat: string): Promise<void> {
  const logger = new Logger('MediumService');
  const secretId = `sites/${userId}/github-pat`;
  let client: SecretsManagerClient;

  try {
    // 1. Get temporary credentials from user service
  const data = await this.fetchTempCredentials(userId);

    const { accessKeyId, secretAccessKey, sessionToken } = data;
    const sts = new AWS.STS(data);
    const { Account: accountId } = await sts.getCallerIdentity().promise();
    logger.log(`Saving PAT for user ${userId} in account ${accountId}`);

    client = new SecretsManagerClient({ region: 'us-east-1', credentials: data });
    try {
      await client.send(new GetSecretValueCommand({ SecretId: secretId }));
      await client.send(new UpdateSecretCommand({ SecretId: secretId, SecretString: pat }));
      logger.log(`Updated PAT at ${secretId}`);
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        await client.send(
          new CreateSecretCommand({
            Name: secretId, // Changed from SecretId to Name
            SecretString: pat,
            Description: `GitHub PAT for user ${userId}`,
          }),
        );
        logger.log(`Created PAT at ${secretId}`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error(`Failed to save PAT for user ${userId}: ${error.message}`);
    throw error;
  } finally {
    client?.destroy();
  }
}

async fetchGitHubPat(userId: number): Promise<string> {
  const logger = new Logger('MediumService');
  const secretId = `sites/${userId}/github-pat`;
  let client: SecretsManagerClient;

  try {
  /*  const { data } = await firstValueFrom(
      this.httpService.post<AwsCredentialsResponse>(`http://localhost:3030/user/${userId}/connect-aws`, {}),
    );*/
     // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
    const sts = new AWS.STS(data);
    const { Account: accountId } = await sts.getCallerIdentity().promise();
    logger.log(`Fetching PAT for user ${userId} in account ${accountId}`);

    client = new SecretsManagerClient({ region: 'us-east-1', credentials: data });
    const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!SecretString) throw new Error(`No PAT found at ${secretId}`);

    logger.log(`Fetched PAT from ${secretId}`);
    return SecretString;
  } catch (error) {
    logger.error(`Failed to fetch PAT for user ${userId}: ${error.message}`);
    throw error;
  } finally {
    client?.destroy();
  }
}

async getPatStatus(userId: number): Promise<{ 
  exists: boolean; 
  valid?: boolean;
  expiry?: string;
  isValid: boolean;
}> {
  const secretId = `sites/${userId}/github-pat`;
  let client: SecretsManagerClient;

  try {
    // 1. Get AWS credentials
   // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;

    // 2. Initialize Secrets Manager client
    client = new SecretsManagerClient({ 
      region: 'us-east-1',
      credentials: {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        sessionToken: data.sessionToken
      }
    });

    // 3. Check secret existence
    const secret = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const pat = secret.SecretString;

    console.log(pat)

    // 4. Validate with GitHub API
    const response = await firstValueFrom(
      this.httpService.get('https://api.github.com/user', {
        headers: { Authorization: `token ${pat}` },
      }),
    );

    // 5. Extract and verify expiration
    const expiryHeader = response.headers['github-authentication-token-expiration'];
    const expiryDate = new Date(expiryHeader.replace(' UTC', '') + 'Z');
    const currentDate = new Date();
    const isExpired = expiryDate <= currentDate;

    // 6. Final validity check
    const isValid = !isExpired && response.status === 200;

    return {
      exists: true,
      valid: true,
      expiry: expiryDate.toISOString(),
      isValid
    };

  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return { exists: false, isValid: false };
    }
    
    // Handle API validation failures
    if (error.response?.status === 401) {
      return {
        exists: true,
        valid: false,
        expiry: undefined,
        isValid: false
      };
    }

    return {
      exists: true,
      valid: false,
      expiry: undefined,
      isValid: false
    };
  } finally {
    client?.destroy();
  }
}

async getPatStatuss(userId: number,pat:string): Promise<{ 
  exists: boolean; 
  valid?: boolean;
  expiry?: string;
  isValid: boolean;
}> {

  try {
    // 1. Get AWS credentials
   // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;

  
    console.log("pat",pat)

    // 4. Validate with GitHub API
    const response = await firstValueFrom(
      this.httpService.get('https://api.github.com/user', {
        headers: { Authorization: `token ${pat}` },
      }),
    );

    // 5. Extract and verify expiration
    const expiryHeader = response.headers['github-authentication-token-expiration'];
    const expiryDate = new Date(expiryHeader.replace(' UTC', '') + 'Z');
    const currentDate = new Date();
    const isExpired = expiryDate <= currentDate;

    // 6. Final validity check
    const isValid = !isExpired && response.status === 200;

    return {
      exists: true,
      valid: true,
      expiry: expiryDate.toISOString(),
      isValid
    };

  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return { exists: false, isValid: false };
    }
    
    // Handle API validation failures
    if (error.response?.status === 401) {
      return {
        exists: true,
        valid: false,
        expiry: undefined,
        isValid: false
      };
    }

    return {
      exists: true,
      valid: false,
      expiry: undefined,
      isValid: false
    };
  } finally {
 
  }
}





/*async restoreDbToPointInTime(
    userId: number,
    dbInstanceIdentifier: string,
    restoreTime: string | null, // ISO string or null for latest restorable time
    targetDbInstanceIdentifier: string,
  ): Promise<any> {
    let client: RDSClient;

    try {
      // Get AWS credentials
      const { data } = await firstValueFrom(
        this.httpService.post<AwsCredentialsResponse>(`http://localhost:3030/user/${userId}/connect-aws`, {}),
      );

      // Initialize RDS client
      client = new RDSClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: data.accessKeyId,
          secretAccessKey: data.secretAccessKey,
          sessionToken: data.sessionToken,
        },
      });

      // Validate restore time
      const restoreDate = restoreTime ? new Date(restoreTime) : null;
      if (restoreDate && (isNaN(restoreDate.getTime()) || restoreDate > new Date())) {
        throw new Error('Invalid restore time');
      }

      // Prepare restore command
      const command = new RestoreDBInstanceToPointInTimeCommand({
        SourceDBInstanceIdentifier: dbInstanceIdentifier,
        TargetDBInstanceIdentifier: targetDbInstanceIdentifier,
        UseLatestRestorableTime: !restoreTime,
        RestoreTime: restoreDate || undefined, // Pass Date object directly
        PubliclyAccessible: false, // Set to false
        DBSubnetGroupName: undefined, // Use source's subnet group
        VpcSecurityGroupIds: undefined, // Use source's security groups
        DBParameterGroupName: undefined, // Use source's parameter group
        Tags: [
          { Key: 'UserId', Value: userId.toString() },
          { Key: 'Environment', Value: 'Restored' },
        ],
        DeletionProtection: true,
      });

      // Execute restore
      const response = await client.send(command);
      console.log('DB Restore initiated:', response);

      
      return {
        message: `Restore initiated for ${targetDbInstanceIdentifier}`,
        dbInstance: response.DBInstance,
      };
    } catch (error: any) {
      console.error('Error restoring DB:', error);
      throw new Error(error.message || 'Failed to restore DB instance');
    } finally {
      client?.destroy();
    }
  }*/


  
}



export function runTerraformCommand(args: string[], cwd: string, env: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('terraform', args, { cwd, env, shell: true });

    child.stdout.on('data', (data) => process.stdout.write(`[TF] ${data}`));
    child.stderr.on('data', (data) => process.stderr.write(`[TF ERROR] ${data}`));

    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`Terraform exited with code ${code}`));
    });
  });



  
}