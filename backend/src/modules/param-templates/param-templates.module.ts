import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParamTemplate } from './entities/param-template.entity';
import { ParamTemplatesService } from './param-templates.service';
import { ParamTemplatesController } from './param-templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ParamTemplate])],
  controllers: [ParamTemplatesController],
  providers: [ParamTemplatesService],
  exports: [ParamTemplatesService],
})
export class ParamTemplatesModule {}
