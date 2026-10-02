import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalcTemplate, CalcRecord } from './entities/calc.entity';
import { CalcSheet } from './entities/calc-sheet.entity';
import { CalcToolsService } from './calc-tools.service';
import { CalcToolsController, CalcRecordsController } from './calc-tools.controller';
import { CalcSheetsController } from './calc-sheets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CalcTemplate, CalcRecord, CalcSheet])],
  controllers: [CalcToolsController, CalcRecordsController, CalcSheetsController],
  providers: [CalcToolsService],
  exports: [CalcToolsService],
})
export class CalcToolsModule {}
