import { Injectable } from '@nestjs/common';
import { RDSClient,CreateDBSnapshotCommand } from '@aws-sdk/client-rds';
import {
  CodeBuildClient,
  StartBuildCommand,
} from "@aws-sdk/client-codebuild";

import {
  RDS,
  RestoreDBInstanceToPointInTimeCommand,
  RestoreDBInstanceFromDBSnapshotCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  DeleteDBInstanceCommand,
  ModifyDBInstanceCommand
} from '@aws-sdk/client-rds';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse , AxiosError} from 'axios';
import { AwsCredentialsResponse } from 'src/medium/interfaces/aws-credentials.interface';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {  GetSecretValueCommand,PutSecretValueCommand,SecretsManagerClient,UpdateSecretCommand,CreateSecretCommand} from '@aws-sdk/client-secrets-manager';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deployment } from 'src/medium/entities/deployment.entity';
import {  Logger , BadRequestException } from '@nestjs/common';
import * as dotenv from 'dotenv' ;
dotenv.config();


@Injectable()
export class RestoredbService {
     constructor(
          @InjectRepository(Deployment)
           private deploymentRepository: Repository<Deployment>,
          
            private httpService: HttpService,
            
        ){
    
        }


   async fetchTempCredentials(userId: number) {
  try {
    // Utilise une variable d'environnement pour l'URL du user-service
    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:3030';
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

   async getAvailableSnapshots(userId: number, dbInstanceIdentifier: string) {
    let client: RDSClient;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<AwsCredentialsResponse>(
          `http://localhost:3030/user/${userId}/connect-aws`,
          {},
        ),
      );

      client = new RDSClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: data.accessKeyId,
          secretAccessKey: data.secretAccessKey,
          sessionToken: data.sessionToken,
        },
      });

      const params = {
        DBInstanceIdentifier: dbInstanceIdentifier,
    //    SnapshotType: 'automated'
      };
      
      const response = await client.send(new DescribeDBSnapshotsCommand(params));
      
      return {
        status: 'success',
        data: (response.DBSnapshots || []).map(snapshot => ({
          id: snapshot.DBSnapshotIdentifier,
          date: snapshot.SnapshotCreateTime,
          type: snapshot.SnapshotType,
          size: snapshot.AllocatedStorage,
          status: snapshot.Status,
          instanceIdentifier: snapshot.DBInstanceIdentifier,
        })),
        retentionPolicy: 'Automated snapshots are retained for 35 days'
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Failed to retrieve snapshots: ${error.message}`,
        errorCode: 'SNAPSHOT_FETCH_ERROR'
      };
    } finally {
      client?.destroy();
    }
  }
  


    async createManualSnapshotAndRestore(
      siteName: string,
      userId: number,
      dbInstanceIdentifier: string,
      targetDbInstanceIdentifier: string
    ): Promise<any> {
      let client: RDSClient;
      let secretsManager: SecretsManagerClient;
    
      try {
        // Get AWS credentials
        // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
    
        // Initialize AWS clients
        const config = {
          region: 'us-east-1',
          credentials: {
            accessKeyId: data.accessKeyId,
            secretAccessKey: data.secretAccessKey,
            sessionToken: data.sessionToken,
          },
        };
        
        client = new RDSClient(config);
        secretsManager = new SecretsManagerClient(config);
    
        // 1. Créer un snapshot manuel
        const snapshotId = `manual-${dbInstanceIdentifier}-${Date.now()}`;
        const createSnapshotCommand = new CreateDBSnapshotCommand({
          DBInstanceIdentifier: dbInstanceIdentifier,
          DBSnapshotIdentifier: snapshotId
        });
        
        await client.send(createSnapshotCommand);
        console.log(`Manual snapshot created: ${snapshotId}`);
        
        // 2. Attendre que le snapshot soit disponible
        await this.waitForSnapshotAvailable(client, snapshotId);
    
        // 3. Restaurer à partir du snapshot
        return await this.restoreDbFromSnapshot(
          siteName,
          userId,
          dbInstanceIdentifier,
          snapshotId,
          targetDbInstanceIdentifier
        );
      } catch (error: any) {
        console.error(`Error creating manual snapshot and restoring:`, error);
        
        // Handle specific AWS errors
        if (error.name === 'DBSnapshotAlreadyExistsFault') {
          throw new Error(`Snapshot already exists:`);
        }
        if (error.name === 'InvalidDBInstanceStateFault') {
          throw new Error('Database is not in a valid state for snapshot');
        }
        
        throw new Error(error.message || 'Failed to create manual snapshot and restore');
      } finally {
        client?.destroy();
        secretsManager?.destroy();
      }
    }
    
    private async restoreDbFromSnapshot(
        siteName: string,
        userId: number,
        dbInstanceIdentifier: string,
        snapshotIdentifier: string,
        targetDbInstanceIdentifier: string,
      ): Promise<any> {
        let client: RDSClient;
        let secretsManager: SecretsManagerClient;
    
        try {
          // Get AWS credentials
       // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
    
          // Initialize AWS clients
          const config = {
            region: 'us-east-1',
            credentials: {
              accessKeyId: data.accessKeyId,
              secretAccessKey: data.secretAccessKey,
              sessionToken: data.sessionToken,
            },
          };
          
          client = new RDSClient(config);
          secretsManager = new SecretsManagerClient(config);
    
          // 1. Get source DB details
          const describeCommand = new DescribeDBInstancesCommand({
            DBInstanceIdentifier: dbInstanceIdentifier
          });
          
          const sourceDbResponse = await client.send(describeCommand);
          
          if (!sourceDbResponse.DBInstances || sourceDbResponse.DBInstances.length === 0) {
            throw new Error(`Source database not found: ${dbInstanceIdentifier}`);
          }
          
          const sourceDb = sourceDbResponse.DBInstances[0];
          console.log('Source DB details:', sourceDb);
    
          // 2. Vérifier que le snapshot est disponible
          await this.waitForSnapshotAvailable(client, snapshotIdentifier);
    
          // 3. Restaurer à partir du snapshot
          const restoreCommand = new RestoreDBInstanceFromDBSnapshotCommand({
            DBSnapshotIdentifier: snapshotIdentifier,
            DBInstanceIdentifier: targetDbInstanceIdentifier,
            PubliclyAccessible: sourceDb.PubliclyAccessible,
            DBSubnetGroupName: sourceDb.DBSubnetGroup?.DBSubnetGroupName,
            VpcSecurityGroupIds: sourceDb.VpcSecurityGroups?.map(sg => sg.VpcSecurityGroupId),
            DBParameterGroupName: sourceDb.DBParameterGroups?.[0]?.DBParameterGroupName,
            Tags: [
              { Key: 'UserId', Value: userId.toString() },
              { Key: 'Environment', Value: 'Restored' },
              { Key: 'OriginalName', Value: dbInstanceIdentifier },
            ],
            DeletionProtection: false,
          });
          
          await client.send(restoreCommand);
          console.log(`DB Restore from snapshot ${snapshotIdentifier} initiated`);
    
          // 4. Attendre que l'instance soit disponible
          await this.waitForDbInstanceAvailable(client, targetDbInstanceIdentifier);
          
          // 5. Récupérer les détails de l'instance restaurée
          const { endpoint: tempEndpoint, port: tempPort } = await this.getDbEndpoint(
            client,
            targetDbInstanceIdentifier
          );
          console.log(`Restored instance endpoint: ${tempEndpoint}:${tempPort}`);
          
          // 6. Mettre à jour Secrets Manager
          const secretName = `sites/${userId}/${siteName}`;
          const originalEndpoint = sourceDb.Endpoint?.Address;
          
          await this.updateDbSecret(
            secretsManager,
            targetDbInstanceIdentifier,
            secretName,
            tempEndpoint,
            tempPort
          );
    
          // 7. Supprimer l'instance originale
          const deleteCommand = new DeleteDBInstanceCommand({
            DBInstanceIdentifier: dbInstanceIdentifier,
            SkipFinalSnapshot: true,
            DeleteAutomatedBackups: true,
          });
          
          await client.send(deleteCommand);
          console.log(`Original instance ${dbInstanceIdentifier} deletion started`);
          await this.waitForDbInstanceDeleted(client, dbInstanceIdentifier);
    
          // 8. Renommer l'instance temporaire
          const renameCommand = new ModifyDBInstanceCommand({
            DBInstanceIdentifier: targetDbInstanceIdentifier,
            NewDBInstanceIdentifier: dbInstanceIdentifier,
            ApplyImmediately: true,
          });
          
          await client.send(renameCommand);
          await this.waitForDbInstanceAvailable(client, dbInstanceIdentifier);
    
          // 9. Récupérer le nouveau endpoint
          const { endpoint: newEndpoint, port: newPort } = await this.getDbEndpoint(
            client,
            dbInstanceIdentifier
          );
          
          // 10. Mettre à jour Secrets Manager avec le nom original
          await this.updateDbSecret(
            secretsManager,
            dbInstanceIdentifier,
            secretName,
            newEndpoint,
            newPort
          );
    
          // 11. Réinitialiser l'accès admin Drupal
    
          return {
            message: `Database restored from snapshot ${snapshotIdentifier} to ${dbInstanceIdentifier}`,
            dbInstance: {
              identifier: dbInstanceIdentifier,
              status: 'available',
              endpoint: newEndpoint,
              port: newPort
            },
          };
        } catch (error: any) {
          console.error('Error restoring from snapshot:', error);
          
          // Handle specific AWS errors
          if (error.name === 'DBSnapshotNotFoundFault') {
            throw new Error(`Snapshot not found: ${snapshotIdentifier}`);
          }
          if (error.name === 'DBInstanceNotFoundFault') {
            throw new Error(`Source database not found: ${dbInstanceIdentifier}`);
          }
          if (error.name === 'DBInstanceAlreadyExistsFault') {
            throw new Error('Database instance name already exists');
          }
          
          throw new Error(error.message || 'Failed to restore from snapshot');
        } finally {
          client?.destroy();
          secretsManager?.destroy();
        }
      }
    
      
    
     
    
      private async getDbEndpoint(
        client: RDSClient,
        instanceIdentifier: string
      ): Promise<{ endpoint: string; port: number }> {
        const response = await client.send(
          new DescribeDBInstancesCommand({
            DBInstanceIdentifier: instanceIdentifier
          })
        );
        
        const instance = response.DBInstances?.[0];
        if (!instance?.Endpoint?.Address) {
          throw new Error(`Endpoint not available for ${instanceIdentifier}`);
        }
        
        return {
          endpoint: instance.Endpoint.Address,
          port: instance.Endpoint.Port || 3306
        };
      }
    
      
    
     
    
    
    private async waitForSnapshotAvailable(
        client: RDSClient,
        snapshotId: string,
        timeoutMinutes: number = 30
      ): Promise<void> {
        const startTime = Date.now();
        const timeout = timeoutMinutes * 60 * 1000;
        
        console.log(`Waiting for snapshot ${snapshotId} to become available...`);
        
        while (Date.now() - startTime < timeout) {
          try {
            const response = await client.send(
              new DescribeDBSnapshotsCommand({
                DBSnapshotIdentifier: snapshotId
              })
            );
            
            const snapshot = response.DBSnapshots?.[0];
            if (snapshot?.Status === 'available') {
              console.log(`Snapshot ${snapshotId} is available`);
              return;
            }
            
            console.log(`Snapshot status: ${snapshot?.Status || 'pending'}... waiting`);
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30s
          } catch (error) {
            if (error.name === 'DBSnapshotNotFoundFault') {
              throw new Error(`Snapshot not found: ${snapshotId}`);
            }
            throw error;
          }
        }
        
        throw new Error(`Snapshot ${snapshotId} not available after ${timeoutMinutes} minutes`);
      }


async triggerCodeBuildPipelineWithConnectAws( 
  siteName: string,
  userId: number,
  region = "us-east-1"
): Promise<void> {
  try {
    // 🔑 Obtenir les credentials temporaires
  // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;

    const client = new CodeBuildClient({
      region,
      credentials: {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        sessionToken: data.sessionToken,
      },
    });

    const projectName = `drupal-deployment-${userId}-${siteName}`;

    const command = new StartBuildCommand({
      projectName,
      // 🔁 Optionnel : overrides si besoin
      // environmentVariablesOverride: [
      //   {
      //     name: 'TRIGGERED_BY_RESTORE',
      //     value: 'true',
      //     type: 'PLAINTEXT'
      //   }
      // ]
    });

    const result = await client.send(command);
    console.log(`🚀 CodeBuild triggered for ${projectName}: ${result.build?.id}`);
  } catch (error) {
    console.error("❌ Failed to trigger CodeBuild:", error);
    throw new Error("Pipeline trigger failed");
  }
}
    
    
    
  async restoreDbToPointInTime(
      siteName : string ,
      userId: number,
      dbInstanceIdentifier: string,
      restoreTime: string | null,
      targetDbInstanceIdentifier: string,
    ): Promise<any> {
      let client: RDSClient;
      let secretsManager: SecretsManagerClient;
    
      try {
        // Get AWS credentials
       // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;
    
        // Initialize AWS clients
        const config = {
          region: 'us-east-1',
          credentials: {
            accessKeyId: data.accessKeyId,
            secretAccessKey: data.secretAccessKey,
            sessionToken: data.sessionToken,
          },
        };
        
        client = new RDSClient(config);
        secretsManager = new SecretsManagerClient(config);
    
        // Validate restore time
        const restoreDate = restoreTime ? new Date(restoreTime) : null;
        if (restoreDate && (isNaN(restoreDate.getTime()) || restoreDate > new Date())) {
          throw new Error('Invalid restore time');
        }
    
        // 1. Get source DB details first
        const describeCommand = new DescribeDBInstancesCommand({
          DBInstanceIdentifier: dbInstanceIdentifier
        });
        
        const sourceDbResponse = await client.send(describeCommand);
        
        if (!sourceDbResponse.DBInstances || sourceDbResponse.DBInstances.length === 0) {
          throw new Error(`Source database not found: ${dbInstanceIdentifier}`);
        }
        
        const sourceDb = sourceDbResponse.DBInstances[0];
        console.log('Source DB details:', sourceDb);
    
        // 2. Restore to temporary instance
        const restoreCommand = new RestoreDBInstanceToPointInTimeCommand({
          SourceDBInstanceIdentifier: dbInstanceIdentifier,
          TargetDBInstanceIdentifier: targetDbInstanceIdentifier,
          UseLatestRestorableTime: !restoreTime,
          RestoreTime: restoreDate || undefined,
          PubliclyAccessible: sourceDb.PubliclyAccessible,
          DBSubnetGroupName: sourceDb.DBSubnetGroup?.DBSubnetGroupName,
          VpcSecurityGroupIds: sourceDb.VpcSecurityGroups?.map(sg => sg.VpcSecurityGroupId),
          DBParameterGroupName: sourceDb.DBParameterGroups?.[0]?.DBParameterGroupName,
          Tags: [
            { Key: 'UserId', Value: userId.toString() },
            { Key: 'Environment', Value: 'Restored' },
            { Key: 'OriginalName', Value: dbInstanceIdentifier },
          ],
          DeletionProtection: false,
        });
    
        const restoreResponse = await client.send(restoreCommand);
        console.log('DB Restore initiated:', restoreResponse);
    
        // Wait for restore to complete
        await this.waitForDbInstanceAvailable(client, targetDbInstanceIdentifier);
    
       
    
    
        // ⭐ Récupérer les détails ACTUALISÉS
    const describeRestoredCommand = new DescribeDBInstancesCommand({
      DBInstanceIdentifier: targetDbInstanceIdentifier
    });
    
    console.log("describeRestoredCommand",describeRestoredCommand)
    const restoredDb = await client.send(describeRestoredCommand);
    
    // ✅ Vérifier l'endpoint ici
    const tempEndpoint = restoredDb.DBInstances?.[0]?.Endpoint?.Address;
    
    if (!tempEndpoint) {
      throw new Error('Restored instance has no endpoint after becoming available');
    }
        
        // 3. Update application to use temporary instance
        const secretName = `sites/${userId}/${siteName}`;
        
        console.log(tempEndpoint)
    
        
        if (!tempEndpoint) {
          throw new Error('Failed to get endpoint for restored instance');
        }
    
        // Save original endpoint for later
        const originalEndpoint = sourceDb.Endpoint?.Address;
        
        // Update secret to point to temporary instance
        await this.updateDbSecret(
          secretsManager,
          targetDbInstanceIdentifier,
          secretName,
          tempEndpoint,
          restoreResponse.DBInstance?.Endpoint?.Port || 3306
        );



        // 4. Delete original instance
        const deleteCommand = new DeleteDBInstanceCommand({
          DBInstanceIdentifier: dbInstanceIdentifier,
          SkipFinalSnapshot: true,
          DeleteAutomatedBackups: true,
        });
        
        await client.send(deleteCommand);
        console.log(`Original instance ${dbInstanceIdentifier} deletion started`);
    
        // Wait for deletion to complete
        await this.waitForDbInstanceDeleted(client, dbInstanceIdentifier);
    
        // 5. Rename temp instance to original name
        const renameCommand = new ModifyDBInstanceCommand({
          DBInstanceIdentifier: targetDbInstanceIdentifier,
          NewDBInstanceIdentifier: dbInstanceIdentifier,
          ApplyImmediately: true,
        });
        
        await client.send(renameCommand);
        await this.waitForDbInstanceAvailable(client, dbInstanceIdentifier);
    
        // 6. Update secret back to original name (with new endpoint)
        const renamedDbResponse = await client.send(
          new DescribeDBInstancesCommand({
            DBInstanceIdentifier: dbInstanceIdentifier
          })
        );
        
        if (!renamedDbResponse.DBInstances || renamedDbResponse.DBInstances.length === 0) {
          throw new Error('Renamed DB instance not found');
        }
        
        const renamedDb = renamedDbResponse.DBInstances[0];
        const newEndpoint = renamedDb.Endpoint?.Address;
        
        await this.updateDbSecret(
          secretsManager,
          dbInstanceIdentifier,
          secretName,
          newEndpoint || originalEndpoint,
          renamedDb.Endpoint?.Port || 3306
        );

        return {
          message: `Database restored and renamed to original name: ${dbInstanceIdentifier}`,
          dbInstance: {
            identifier: dbInstanceIdentifier,
            status: renamedDb.DBInstanceStatus,
            endpoint: newEndpoint,
            port: renamedDb.Endpoint?.Port
          },
        };
      } catch (error: any) {
        console.error('Error restoring and renaming DB:', error);
        
        // Handle specific AWS errors
        if (error.name === 'DBInstanceNotFoundFault') {
          throw new Error(`Source database not found: ${dbInstanceIdentifier}`);
        }
        if (error.name === 'InvalidRestoreFault') {
          throw new Error('Invalid restore time or point not available');
        }
        if (error.name === 'DBInstanceAlreadyExistsFault') {
          throw new Error('Database instance name already exists');
        }
        
        throw new Error(error.message || 'Failed to restore and rename DB instance');
      } finally {
        client?.destroy();
        secretsManager?.destroy();
      }
    }


      async restoreDbToPointInTimee(
  siteName: string,
  userId: number,
  dbInstanceIdentifier: string,
  restoreTime: string | null
): Promise<any> {
  let client: RDSClient;
  let secretsManager: SecretsManagerClient;

  try {
  // 1. Get temporary credentials from user service
        const data = await this.fetchTempCredentials(userId);

         const { accessKeyId, secretAccessKey, sessionToken } = data;

    const config = {
      region: "us-east-1",
      credentials: {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        sessionToken: data.sessionToken,
      },
    };

    client = new RDSClient(config);
    secretsManager = new SecretsManagerClient(config);

    const restoreDate = restoreTime ? new Date(restoreTime) : null;
    if (restoreDate && (isNaN(restoreDate.getTime()) || restoreDate > new Date())) {
      throw new Error("Invalid restore time");
    }

    // ✅ Restore directly to the original instance identifier
    const restoreCommand = new RestoreDBInstanceToPointInTimeCommand({
      SourceDBInstanceIdentifier: dbInstanceIdentifier,
      TargetDBInstanceIdentifier: dbInstanceIdentifier,
      UseLatestRestorableTime: !restoreTime,
      RestoreTime: restoreDate || undefined,
      DeletionProtection: false,
    });

    await client.send(restoreCommand);
    console.log(`🕒 Restore to point-in-time initiated for ${dbInstanceIdentifier}`);

    // Wait for DB to be available again
    await this.waitForDbInstanceAvailable(client, dbInstanceIdentifier);
    console.log(`✅ DB ${dbInstanceIdentifier} restored and ready`);

    // Get new endpoint details
    const dbRes = await client.send(
      new DescribeDBInstancesCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
      })
    );

    const db = dbRes.DBInstances?.[0];
    const endpoint = db?.Endpoint?.Address;
    const port = db?.Endpoint?.Port;

    if (!endpoint) {
      throw new Error("Restored DB endpoint not available");
    }

    // ✅ Update Secrets Manager to make sure app still points to same DB
    const secretId = `sites/${userId}/${siteName}`;

    await secretsManager.send(
      new UpdateSecretCommand({
        SecretId: secretId,
        SecretString: JSON.stringify({
          host: endpoint,
          port: port || 3306,
          db_name: db.DBName,
          db_user: "user",
          db_password: data.dbPassword || "********",
        }),
      })
    );

    return {
      message: `✅ RDS database ${dbInstanceIdentifier} restored successfully.`,
      dbInstance: {
        identifier: dbInstanceIdentifier,
        status: db.DBInstanceStatus,
        endpoint: endpoint,
        port: port,
      },
    };
  } catch (error: any) {
    console.error("❌ RDS Restore Error:", error);

    if (error.name === "DBInstanceNotFoundFault") {
      throw new Error(`DB not found: ${dbInstanceIdentifier}`);
    }

    if (error.name === "InvalidRestoreFault") {
      throw new Error("Restore time is invalid or unavailable");
    }

    throw new Error(error.message || "Unknown restore error");
  } finally {
    client?.destroy();
    secretsManager?.destroy();
  }
}
    
    private async waitForDbInstanceAvailable(
      client: RDSClient,
      instanceIdentifier: string,
      timeoutMinutes: number = 30
    ): Promise<void> {
    
      console.log("hellouu")
      const startTime = Date.now();
      const timeout = timeoutMinutes * 60 * 1000;
      
      while (Date.now() - startTime < timeout) {
        try {
          const response = await client.send(
            new DescribeDBInstancesCommand({
              DBInstanceIdentifier: instanceIdentifier
            })
          );
          
          const instance = response.DBInstances?.[0];
          if (instance?.DBInstanceStatus === 'available') {
            return;
          }
        } catch (error) {
          if (error.name === 'DBInstanceNotFoundFault') {
            // Continue waiting
          } else {
            throw error;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      }
      
      throw new Error(`Timed out waiting for DB instance ${instanceIdentifier} to become available`);
    }
    
    private async waitForDbInstanceDeleted(
      client: RDSClient,
      instanceIdentifier: string,
      timeoutMinutes: number = 30
    ): Promise<void> {
      const startTime = Date.now();
      const timeout = timeoutMinutes * 60 * 1000;
      
      while (Date.now() - startTime < timeout) {
        try {
          await client.send(
            new DescribeDBInstancesCommand({
              DBInstanceIdentifier: instanceIdentifier
            })
          );
        } catch (error) {
          if (error.name === 'DBInstanceNotFoundFault') {
            return; // Deletion complete
          }
          throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      }
      
      throw new Error(`Timed out waiting for DB instance ${instanceIdentifier} to be deleted`);
    }
    
    private async updateDbSecret(
      client: SecretsManagerClient,      
      targetDbInstanceIdentifier : string,
      secretName: string,
      host: string,
      port: number
    ): Promise<void> {
      try {
        // Get existing secret
        const getSecretResponse = await client.send(
          new GetSecretValueCommand({ SecretId: secretName })
        );
        
        if (!getSecretResponse.SecretString) {
          throw new Error('Secret has no string value');
        }
        
        const secretValue = JSON.parse(getSecretResponse.SecretString);
        
        // Update connection details
        const updatedSecret = {
          ...secretValue,
          db_name :       targetDbInstanceIdentifier,
          db_endpoint: host,
          db_port: port
        };
        
        // Update secret
        await client.send(
          new UpdateSecretCommand({
            SecretId: secretName,
            SecretString: JSON.stringify(updatedSecret),
          })
        );
        
        console.log(`Updated secret ${secretName} with new endpoint: ${host}:${port}`);
      } catch (error) {
        console.error('Failed to update DB secret:', error);
        throw new Error('Could not update database connection secret');
      }
    }
    
    
}
