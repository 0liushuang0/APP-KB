import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

export class AddManufacturingWorkflow1788700000000 implements MigrationInterface {
  name = 'AddManufacturingWorkflow1788700000000';

  public async up(q: QueryRunner): Promise<void> {
    const id = q.connection.options.type === 'postgres'
      ? 'uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()'
      : 'varchar PRIMARY KEY NOT NULL';
    const tables: Array<[string, string]> = [
      ['manufacturing_cases', `"customerId" varchar NOT NULL, "requirementId" varchar,
        "quotationId" varchar, "contractId" varchar, "projectId" varchar,
        "title" varchar NOT NULL, "businessType" varchar NOT NULL, "stage" varchar NOT NULL DEFAULT 'qualification',
        "status" varchar NOT NULL DEFAULT 'open', "ownerId" varchar, "technicalOwnerId" varchar, "participantIds" text,
        "expectedDealDate" varchar, "expectedAmount" decimal(14,2), "nextAction" varchar,
        "nextActionDue" varchar, "decisionContext" text, "competitorContext" text,
        "lossReason" text, "version" integer NOT NULL DEFAULT 1`],
      ['customer_equipment', `"customerId" varchar NOT NULL, "ownerId" varchar NOT NULL, "siteName" varchar NOT NULL,
        "lineName" varchar, "equipmentNo" varchar, "model" varchar NOT NULL,
        "serialNo" varchar, "contractId" varchar, "projectId" varchar,
        "drawingNo" varchar, "drawingVersion" varchar, "acceptedAt" varchar,
        "operatingContext" text, "configuration" text`],
      ['technical_compliance', `"caseId" varchar NOT NULL, "requirementText" varchar NOT NULL,
        "sourceRef" varchar, "response" text, "verdict" varchar NOT NULL DEFAULT 'unconfirmed',
        "deviation" text, "verificationMethod" varchar, "ownerId" varchar,
        "confirmedBy" varchar, "confirmedAt" varchar`],
      ['manufacturing_reviews', `"caseId" varchar NOT NULL, "department" varchar NOT NULL,
        "verdict" varchar NOT NULL DEFAULT 'pending', "note" text, "conditionText" varchar,
        "reviewedBy" varchar, "reviewedAt" varchar`],
      ['engineering_changes', `"caseId" varchar NOT NULL, "projectId" varchar, "title" varchar NOT NULL,
        "reason" text NOT NULL, "beforeState" text NOT NULL, "afterState" text NOT NULL,
        "costDelta" decimal(14,2) NOT NULL DEFAULT 0, "scheduleDeltaDays" integer NOT NULL DEFAULT 0,
        "status" varchar NOT NULL DEFAULT 'draft', "customerEvidenceRef" varchar,
        "raisedBy" varchar, "approvedBy" varchar, "approvedAt" varchar`],
      ['delivery_milestones', `"projectId" varchar NOT NULL, "name" varchar NOT NULL, "kind" varchar NOT NULL DEFAULT 'other',
        "promisedAt" varchar, "forecastAt" varchar, "actualAt" varchar,
        "status" varchar NOT NULL DEFAULT 'pending', "ownerId" varchar, "evidenceRef" varchar,
        "externalSystem" varchar, "externalId" varchar, "blocker" text`],
    ];
    for (const [name, columns] of tables) {
      if (await q.hasTable(name)) continue;
      await q.query(compat(q, `CREATE TABLE "${name}" ("id" ${id}, ${columns},
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`));
    }
    const indexes: Array<[string, string, string]> = [
      ['manufacturing_cases', 'customerId', 'customer'],
      ['manufacturing_cases', 'requirementId', 'requirement'],
      ['manufacturing_cases', 'businessType, stage', 'type_stage'],
      ['customer_equipment', 'customerId', 'customer'],
      ['customer_equipment', 'serialNo', 'serial'],
      ['technical_compliance', 'caseId', 'case'],
      ['manufacturing_reviews', 'caseId, department', 'case_dept'],
      ['engineering_changes', 'caseId', 'case'],
      ['engineering_changes', 'projectId', 'project'],
      ['delivery_milestones', 'projectId', 'project'],
    ];
    for (const [table, columns, suffix] of indexes) {
      const name = `IDX_${table}_${suffix}`;
      const cols = columns.split(', ').map(c => `"${c}"`).join(', ');
      const unique = table === 'manufacturing_reviews' ? 'UNIQUE ' : '';
      await q.query(`CREATE ${unique}INDEX "${name}" ON "${table}" (${cols})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const name of ['delivery_milestones', 'engineering_changes', 'manufacturing_reviews',
      'technical_compliance', 'customer_equipment', 'manufacturing_cases']) {
      if (await q.hasTable(name)) await q.query(`DROP TABLE "${name}"`);
    }
  }
}
