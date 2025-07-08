import { Controller } from '@nestjs/common';

import { Post,Get , Delete ,Body ,HttpException, HttpStatus , Request ,UseGuards } from '@nestjs/common';
import { RestoredbService } from './restoredb.service';
import { TokenGuard } from 'src/medium/Guards/token-guard';
import { BadRequestException } from '@nestjs/common';




interface GetSnapshotsRequest {
  dbInstanceIdentifier: string;
  subAccountId: string;
}


interface RestoreDbRequest {
  siteName : string;
  userId: number;
  dbInstanceIdentifier: string;
  restoreTime: string | null; // ISO string or null for latest restorable time
  targetDbInstanceIdentifier: string;
}


@Controller('restoredb')
export class RestoredbController {

        constructor(private readonly rrestoredbservice : RestoredbService ){
    
        }

@UseGuards(TokenGuard)
        @Post('trigger-codebuild')
  async triggerCodeBuild(
    @Request() req,
    @Body() body : any
  ) {
    const userId = req.user.userId

    if (!body.siteName || !userId) {
      return { error: 'siteName and userId are required' };
    }
    await this.rrestoredbservice.triggerCodeBuildPipelineWithConnectAws(
      body.siteName,
      Number(userId),
     'us-east-1'
    );
    return { message: 'CodeBuild pipeline triggered' };
  }


        @UseGuards(TokenGuard)
          @Post('snapshots')
          async getSnapshots(@Request() req, @Body() body: GetSnapshotsRequest) {
            const userId = req.user.userId; 
            const { dbInstanceIdentifier} = body;
        
        
            try {
              const snapshots = await this.rrestoredbservice.getAvailableSnapshots(userId, dbInstanceIdentifier);
              console.log("heelo",snapshots)
              return {
                message: `Successfully retrieved snapshots for ${dbInstanceIdentifier}`,
                snapshots,
              };
            } catch (error) {
              throw new BadRequestException(`Failed to retrieve snapshots: ${error.message}`);
            }
          }
        
        
          
        
        
          @UseGuards(TokenGuard)
          @Post('restore-db')
          async restoreDbToPointInTime(@Body() body: RestoreDbRequest , @Request() req) {
            try {
              // userId m token 
              // dbinstanceidentifier sitename & userId => ofnction twali tekhou userId & site Name 
              const {  restoreTime  , siteName} = body;
              const userId = req.user.userId
              const dbInstanceIdentifier = `db-${userId}-${siteName}`
              const targetDbInstanceIdentifier = `${dbInstanceIdentifier}-restored`
        
              // Validate input
              if (!userId || !dbInstanceIdentifier || !targetDbInstanceIdentifier) {
                throw new HttpException(
                  'Missing required fields: userId, dbInstanceIdentifier, or targetDbInstanceIdentifier',
                  HttpStatus.BAD_REQUEST,
                );
              }
        
              // Call service to restore DB
              const response = await this.rrestoredbservice.restoreDbToPointInTime(
                siteName,
                userId,
                dbInstanceIdentifier,
                restoreTime,
               targetDbInstanceIdentifier,
              );
        
              return {
                status: 'success',
                message: response.message,
                dbInstance: response.dbInstance,
              };
            } catch (error: any) {
              throw new HttpException(
                error.message || 'Failed to initiate DB restore',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }
          }



 @UseGuards(TokenGuard)
  @Post('available-snapshots')
  async getAvailableSnapshots(
    @Body() body : any,
    @Request() req
  ) {
    const userId = req.user.userId;
    const dbInstanceIdentifier = `db-${userId}-${body.siteName}`;
    console.log("hello from")

    try {
      const response = await this.rrestoredbservice.getAvailableSnapshots(userId, dbInstanceIdentifier);
      
      if (response.status === 'error') {
        throw new HttpException(response.message, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      // Formatage correct avec les propriétés AWS SDK v3
      const calendarData = response.data.map(snap => ({
        date: snap.date, // Utiliser directement la date formatée du service
        type: snap.type,
        id: snap.id,
        size: snap.size,
        status: snap.status
      }));

      return {
        status: 'success',
        data: calendarData,
        retentionPeriod: response.retentionPolicy || '35 jours'
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch snapshots',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }


    
    

    @Post('create-snapshot-and-restore')
      async createSnapshotAndRestore(@Body() body: any) {
        try {
          const { siteName, userId, dbInstanceIdentifier, targetDbInstanceIdentifier } = body;
    
          // Validation des paramètres
          if (!siteName || !userId || !dbInstanceIdentifier || !targetDbInstanceIdentifier) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
          }
    
          const result = await this.rrestoredbservice.createManualSnapshotAndRestore(
            siteName,
            userId,
            dbInstanceIdentifier,
            targetDbInstanceIdentifier
          );
    
          return {
            success: true,
            message: 'Manual snapshot created and restoration started',
            snapshotId: result.snapshotId,
            data: result
          };
        } catch (error) {
          throw new HttpException({
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            error: error.message || 'Snapshot creation and restoration failed',
          }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
      }
    

}
