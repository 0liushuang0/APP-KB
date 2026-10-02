import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { BackupService } from './backup.service';
import { Roles } from '../../common/decorators/roles.decorator';

class CreateBackupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

@ApiTags('备份还原')
@Controller('backup')
@Roles('admin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get()
  list() {
    return this.backupService.list();
  }

  /** 还原状态：重启后前端据此提示"已还原"或"还原失败" */
  @Get('restore-status')
  restoreStatus() {
    return {
      ...this.backupService.lastRestoreResult(),
      pending: this.backupService.isRestorePending(),
    };
  }

  @Delete('restore-status')
  ackRestoreStatus() {
    this.backupService.acknowledgeRestoreFailure();
    return { success: true };
  }

  @Post()
  create(@Body() dto: CreateBackupDto) {
    return this.backupService.create(dto.note);
  }

  /** 下载备份 —— 用户应把它拷到本机之外，放在同一块盘上等于没备份 */
  @Get(':fileName/download')
  download(@Param('fileName') fileName: string, @Res({ passthrough: true }) res: Response) {
    const filePath = this.backupService.getPath(fileName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return new StreamableFile(fs.createReadStream(filePath));
  }

  /** 还原：校验后标记，重启生效 */
  @Post(':fileName/restore')
  restore(@Param('fileName') fileName: string) {
    return this.backupService.prepareRestore(fileName);
  }

  @Delete(':fileName')
  remove(@Param('fileName') fileName: string) {
    this.backupService.remove(fileName);
    return { success: true };
  }
}
