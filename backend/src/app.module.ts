import { OpsHealthModule } from './modules/ops-health/ops-health.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { UserGroupsModule } from './modules/user-groups/user-groups.module';
import { RolesModule } from './modules/roles/roles.module';
import { SystemModule } from './modules/system/system.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ZhSettingsModule } from './modules/zh-settings/zh-settings.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { SearchModule } from './modules/search/search.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { AfterSalesModule } from './modules/after-sales/after-sales.module';
import { WorkTasksModule } from './modules/work-tasks/work-tasks.module';
import { ProductsModule } from './modules/products/products.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RequirementsModule } from './modules/requirements/requirements.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AiModule } from './modules/ai/ai.module';
import { SolutionsModule } from './modules/solutions/solutions.module';
import { ParamTemplatesModule } from './modules/param-templates/param-templates.module';
import { CalcToolsModule } from './modules/calc-tools/calc-tools.module';
import { FilesModule } from './modules/files/files.module';
import { ClientErrorsModule } from './modules/client-errors/client-errors.module';
import { BackupModule } from './modules/backup/backup.module';
import { DataPortabilityModule } from './modules/data-portability/data-portability.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProductSeedModule } from './modules/products/seeds/product-seed.module';
import { FileArchiveModule } from './common/services/file-archive.module';
import { SanitizerModule } from './common/services/sanitizer.module';
import { FileEncryptionModule } from './common/services/file-encryption.module';
import { FileWatchdogModule } from './common/services/file-watchdog.module';
import { TaskQueueModule } from './common/services/task-queue.module';
import { KeychainModule } from './common/services/keychain.module';
import { TagsModule } from './modules/tags/tags.module';
import { RecycleBinModule } from './modules/recycle-bin/recycle-bin.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { NumberingModule } from './modules/numbering/numbering.module';

@Module({
  imports: [
    NumberingModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      envFilePath: ['.env', '../.env'],
    }),
    ThrottlerModule.forRoot([
      {
        // 短窗口：10 秒内每 IP 最多 200 次（50 人团队 × 4 并发够用，压测可过）
        name: 'short',
        ttl: 10000,
        limit: parseInt(process.env.THROTTLE_SHORT_LIMIT || '200', 10),
      },
      {
        // 长窗口：1 分钟内每 IP 最多 2000 次
        name: 'long',
        ttl: 60000,
        limit: parseInt(process.env.THROTTLE_LONG_LIMIT || '2000', 10),
      },
    ]),
    TypeOrmModule.forRootAsync({
      useFactory: databaseConfig,
    }),
    AuthModule,
    UsersModule,
    DepartmentsModule,
    UserGroupsModule,
    RolesModule,
    SystemModule,
    SystemConfigModule,
    DocumentsModule,
    ZhSettingsModule,
    ApprovalsModule,
    SearchModule,
    CustomersModule,
    ProposalsModule,
    QuotationsModule,
    ContractsModule,
    AfterSalesModule,
    WorkTasksModule,
    ProductsModule,
    SuppliersModule,
    MaterialsModule,
    ProjectsModule,
    RequirementsModule,
    AuditLogsModule,
    AiModule,
    SolutionsModule,
    ParamTemplatesModule,
    CalcToolsModule,
    FilesModule,
    ClientErrorsModule,
    BackupModule,
    DataPortabilityModule,
    NotificationsModule,
    ProductSeedModule,
    FileArchiveModule,
    SanitizerModule,
    FileEncryptionModule,
    FileWatchdogModule,
    TaskQueueModule.register(),
    KeychainModule,
    TagsModule,
    RecycleBinModule,
    MetricsModule,
    OpsHealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: 'APP_INTERCEPTOR',
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
