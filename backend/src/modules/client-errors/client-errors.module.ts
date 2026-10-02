import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientError } from './client-error.entity';
import { ClientErrorsController } from './client-errors.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ClientError])],
  controllers: [ClientErrorsController],
})
export class ClientErrorsModule {}
