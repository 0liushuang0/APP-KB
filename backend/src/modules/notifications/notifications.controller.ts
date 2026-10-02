import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('通知中心')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@Query('unreadOnly') unreadOnly: string, @CurrentUser() user: CurrentUserType) {
    return this.notificationsService.findAll(user.userId, unreadOnly === 'true');
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: CurrentUserType) {
    return this.notificationsService.getUnreadCount(user.userId);
  }

  @Post(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: CurrentUserType) {
    return this.notificationsService.markAllRead(user.userId);
  }
}
