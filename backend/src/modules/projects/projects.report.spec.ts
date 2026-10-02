import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

describe('project completion report', () => {
  it('denies a public-project viewer access to financial details', async () => {
    const service = Object.create(ProjectsService.prototype) as ProjectsService;
    (service as any).projectRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'project-1', managerId: 'manager', visibility: 'public' }),
    };
    (service as any).memberRepository = { findOne: jest.fn().mockResolvedValue(null) };
    (service as any).permissionService = { canAccess: () => true, isSingleMode: () => false };
    await expect(service.generateCompletionReport('project-1', { userId: 'viewer' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
