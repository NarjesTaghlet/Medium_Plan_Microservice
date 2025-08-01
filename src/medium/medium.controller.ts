import { Controller,BadRequestException } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { Post,Get , Delete } from '@nestjs/common';
import { MediumService } from './medium.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Request } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { TokenGuard } from './Guards/token-guard';
import { Param } from '@nestjs/common';
import { Deployment } from './entities/deployment.entity';
import { Req } from '@nestjs/common';




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
  
  @Post('github-pat/:userId')
  async fetchGitHubPat(@Param('userId') userId: string): Promise<{ pat: string }> {
    try {
      const numericUserId = parseInt(userId, 10);
      
      // Validation basique de l'userId
      if (isNaN(numericUserId)) {
        throw new HttpException('Invalid user ID format', HttpStatus.BAD_REQUEST);
      }

      // Logique de récupération du PAT
      const pat = await this.mediumService.fetchGitHubPat(numericUserId);
      
      return { pat };
    } catch (error) {
      console.log(`Failed to fetch PAT for user ${userId}: ${error.message}`);

      // Gestion des erreurs spécifiques
      switch (error.name) {
        case 'ResourceNotFoundException':
          throw new HttpException('PAT not found', HttpStatus.NOT_FOUND);
        case 'InvalidSignatureException':
          throw new HttpException('Invalid AWS credentials', HttpStatus.UNAUTHORIZED);
        default:
          throw new HttpException(
            'Failed to retrieve GitHub PAT',
            HttpStatus.INTERNAL_SERVER_ERROR
          );
      }
    }
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

  @Get('status/:id')
@UseGuards(TokenGuard)
async getDeploymentStatus(@Param('id') id: number) {

 const result =  this.mediumService.getDeploymentStatus(id)


  return result;
}

  
/* // original function
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
*/

@Delete('deployment/:id')
async delete(@Param('id') id: string): Promise<{ message: string }> {
  const deploymentId = parseInt(id);

  // Trigger deletion logic asynchronously
  this.mediumService.deleteSite(deploymentId).catch((error) => {
    console.error(`Async deletion failed: ${error.message}`);
  });

  return { message: `Deletion initiated for deployment ${deploymentId}` };
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

  
  @UseGuards(TokenGuard)
  @Post('pat-status-save')
  async getPatStatusSave(@Request() req,@Body() body :any) {
    const userId = req.user?.userId;
    console.log('userId (getPatStatus):', userId);

    if (!userId) {
      throw new HttpException('Invalid user ID', HttpStatus.BAD_REQUEST);
    }

    try {
      const status = await this.mediumService.getPatStatuss(userId,body.pat);
      console.log('Returning PAT status:', status);
      return status;
    } catch (error) {
      throw new HttpException(`Failed to check PAT status: ${error.message}`, HttpStatus.NOT_FOUND);
    }
  }
}






