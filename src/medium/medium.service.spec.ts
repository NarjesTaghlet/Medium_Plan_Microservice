import { Test, TestingModule } from '@nestjs/testing';
import { MediumService } from './medium.service';

describe('MediumService', () => {
  let service: MediumService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MediumService],
    }).compile();

    service = module.get<MediumService>(MediumService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
