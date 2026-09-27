import { Module } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { AccessController } from './access.controller.js';

@Module({
  providers: [AccessService],
  controllers: [AccessController],
})
export class AccessModule {}
