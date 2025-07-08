import { Controller,BadRequestException } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { Post,Get , Delete } from '@nestjs/common';
import { DeployInfrastructureDto } from './dtos/deployinterface.dto';
import { MediumService } from './medium.service';
import { HttpService } from '@nestjs/axios';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { TokenGuard } from './Guards/token-guard';
import { Param } from '@nestjs/common';
import { Deployment } from './entities/deployment.entity';
import { Req } from '@nestjs/common';
import { Res } from '@nestjs/common';
import { Response } from 'express';



interface DeployRequest {
  userId : number ;
  siteName: string;
  cloudflareDomain: string;
  selectedStack: string;
}


class DeploymentRequestDto {
  userId: number;
  siteName: string;
  githubRepoUrl: string;
}

@Controller('medium')
export class MediumController {

    constructor(private readonly mediumService : MediumService ){

    }


 

@UseGuards(TokenGuard)
  @Get('sites')
  async getSites(@Req() request: any) :Promise<Deployment[]> {
    const userId = request.user.userId;
    console.log("fro sitesdeployment",userId)
    const deployments = await this.mediumService.findAllForUser(userId);
    return deployments;
  }


   /* @Post('deploy')
    async createDeployment(@Body() createDeploymentDto: DeployInfrastructureDto) {
      const { userId, siteName } = createDeploymentDto;

      const result = await  this.mediumService.deployInfrastructure(createDeploymentDto.userId,createDeploymentDto.siteName)
  return result;
      // Ensure the userId in the body matches the authenticated user
      /*if (userId !== authenticatedUserId) {
        throw new HttpException('User ID in body must match authenticated user', HttpStatus.FORBIDDEN);
      }
  
    }
    */

  @UseGuards(TokenGuard)
  @Get(':id')
  async findOne(@Param('id') id: number): Promise<Deployment> {
      try {
        return await this.mediumService.findOne(id);
      } catch (error) {
        throw new HttpException(
          `Failed to fetch deployment: ${error.message}`,
          HttpStatus.NOT_FOUND,
        );
      }
    } 


  
    @UseGuards(TokenGuard)
    @Post('check-name-unique')
    async checkSiteNameUnique(
      @Body() siteName: string
    ) {
      return this.mediumService.isSiteNameUnique(siteName);
    }
  
    
 
  @UseGuards(TokenGuard)
  @Post('final')
  async createDeployment(@Body() createDeploymentDto: DeployRequest, @Request() req) {
    const { siteName, cloudflareDomain, selectedStack } = createDeploymentDto;

    // Extract the authenticated user's ID from the token
    const userId = req.user.userId;

    console.log( userId )
    console.log("hel:lp")

    return this.mediumService.createDeployment(
      userId,
      siteName,
      cloudflareDomain,
      selectedStack,
    );
  }
  

  @Delete('deployment/:id')
  async delete(@Param('id') id: string): Promise<void> {
    try {
      await this.mediumService.deleteSite(parseInt(id));
    } catch (error) {
      throw new HttpException(
        `Failed to delete deployment: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /*  @Post('test-deploy')
    async deployInfrastructure(
      @Body() body: DeploymentRequestDto,
      @Res() res: Response
    ) {
      try {
        const result = await this.mediumService.deployInfrastructure(
          body.userId,
          body.siteName,
          body.githubRepoUrl
        );
  
        res.status(HttpStatus.CREATED).json({
          status: 'success',
          data: result
        });
      } catch (error) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          status: 'error',
          message: error.message,
          details: error.response?.data || {}
        });
      }
    }

*/
  
          
//////////////////////////// GITHUB TOKEN FUNCTIONS
  @UseGuards(TokenGuard)
  @Post('save-github-pat')
  async savePat(@Body() body: {  pat: string } , @Request() req) {
   
    const userId = req.user.userId;
    
    if (!userId || !body.pat.match(/^ghp_[a-zA-Z0-9]{36}$/)) {
      throw new HttpException('Invalid user ID or PAT format', HttpStatus.BAD_REQUEST);
    }
    try {
      await this.mediumService.saveGitHubPat(userId, body.pat);
      return { message: 'PAT saved successfully' };
    } catch (error) {
      throw new HttpException(`Failed to save PAT: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }


  

  @UseGuards(TokenGuard)
  @Post('pat-status')
  async getPatStatus(@Request() req) {
    const userId = req.user?.userId;
    console.log('userId (getPatStatus):', userId);

    if (!userId) {
      throw new HttpException('Invalid user ID', HttpStatus.BAD_REQUEST);
    }

    try {
      const status = await this.mediumService.getPatStatus(userId);
      console.log('Returning PAT status:', status);
      return status;
    } catch (error) {
      throw new HttpException(`Failed to check PAT status: ${error.message}`, HttpStatus.NOT_FOUND);
    }
  }
}






