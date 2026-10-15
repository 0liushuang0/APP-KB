import { BadRequestException } from '@nestjs/common';
import { ContractsService } from './contracts.service';

describe('contract commercial gate', () => {
  const user = { userId: 'owner' } as any;
  const create = (status: string) => {
    const contract = { id: 'contract-1', ownerId: 'owner', visibility: 'public', status,
      customerId: 'customer-1', quotationId: 'quote-1', amount: 100 };
    const repository = { findOne: jest.fn().mockResolvedValue(contract) };
    const permissions = { canAccess: () => true, canManage: () => true };
    const tx = { run: jest.fn() };
    const service = new ContractsService(repository as any, {} as any, {} as any,
      {} as any, permissions as any, {} as any, {} as any, tx as any, { capture: jest.fn() } as any);
    return { service, tx };
  };

  it('rejects direct signing of an unapproved draft', async () => {
    const { service, tx } = create('draft');
    await expect(service.update('contract-1', { status: 'signed', signedDate: '2026-09-30' }, user))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.run).not.toHaveBeenCalled();
  });

  it('freezes price after internal approval', async () => {
    const { service, tx } = create('approved');
    await expect(service.update('contract-1', { amount: 1 }, user))
      .rejects.toThrow('商务条款已冻结');
    expect(tx.run).not.toHaveBeenCalled();
  });
});
