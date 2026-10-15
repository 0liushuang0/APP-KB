import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project, ProjectRisk, ProjectStage } from './entities/project.entity';
import { evaluateHealth } from './project-health';
import { NotificationsService } from '../notifications/notifications.service';
import { recordAutomation } from '../../common/utils/automation-log';

/**
 * 项目健康度每日重算。
 *
 * 健康度会随时间变化（今天还绿，过了计划完工日就该红），只在编辑时算等于永远不变。
 * 启动 1 分钟后跑一次，之后每 24 小时一次；新变红的项目给负责人发一条通知。
 * PROJECT_HEALTH_SCHEDULER=false 可关闭。
 */
@Injectable()
export class ProjectHealthScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ProjectHealthScheduler.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectStage) private readonly stages: Repository<ProjectStage>,
    @InjectRepository(ProjectRisk) private readonly risks: Repository<ProjectRisk>,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.PROJECT_HEALTH_SCHEDULER === 'false' || process.env.NODE_ENV === 'test') return;
    const first = setTimeout(() => void this.runOnce().catch((e) => this.logger.warn(`健康度重算失败：${e?.message}`)), 60_000);
    const every = setInterval(() => void this.runOnce().catch((e) => this.logger.warn(`健康度重算失败：${e?.message}`)), 24 * 3_600_000);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async runOnce(now = new Date()): Promise<{ total: number; changed: number; newlyRed: number }> {
    const all = await this.projects.find();
    if (!all.length) return { total: 0, changed: 0, newlyRed: 0 };
    const ids = all.map((p) => p.id);
    const [stageRows, riskRows] = await Promise.all([
      this.stages.find({ where: { projectId: In(ids) } }),
      this.risks.find({ where: { projectId: In(ids), status: 'open' } }),
    ]);
    let changed = 0;
    let newlyRed = 0;
    for (const p of all) {
      const { health, reason } = evaluateHealth({
        status: p.status,
        progress: p.progress,
        endDate: p.endDate,
        stages: stageRows.filter((s) => s.projectId === p.id),
        risks: riskRows.filter((r) => r.projectId === p.id),
        now,
      });
      if (p.health === health) continue;
      const wasRed = p.health === 'red';
      await this.projects.update(p.id, { health } as any);
      changed++;
      if (health === 'red' && !wasRed) {
        newlyRed++;
        if (p.managerId) {
          this.notifications
            .create({
              type: 'project',
              title: `项目需要关注：${p.name}`,
              content: `${p.projectNo || ''} ${reason}`.trim(),
              recipientId: p.managerId,
              linkUrl: `/projects?highlight=${p.id}`,
            })
            .catch(() => undefined);
        }
      }
    }
    if (newlyRed) await recordAutomation(this.projects.manager, 'project_risk_flagged', newlyRed);
    if (changed) this.logger.log(`项目健康度重算：${all.length} 个项目，${changed} 个变化（新标红 ${newlyRed}）`);
    return { total: all.length, changed, newlyRed };
  }
}
