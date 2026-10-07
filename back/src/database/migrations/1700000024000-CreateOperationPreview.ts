import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOperationPreview1700000024000 implements MigrationInterface {
  name = 'CreateOperationPreview1700000024000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE operation_preview (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind text NOT NULL,
        status text NOT NULL CHECK (status IN ('validating','ready','failed','executing','executed')),
        original_filename text NOT NULL,
        stored_path text NOT NULL,
        report jsonb,
        error_message text,
        import_job_id uuid REFERENCES import_job(id) ON DELETE SET NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX idx_operation_preview_expira ON operation_preview (expires_at)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE operation_preview`);
  }
}
