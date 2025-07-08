import { IsNotEmpty } from 'class-validator';


export class DeployInfrastructureDto {

    @IsNotEmpty()
    userId : number
   
    @IsNotEmpty()
    siteName :string
  
}