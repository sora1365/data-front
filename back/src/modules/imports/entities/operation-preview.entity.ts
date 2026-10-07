import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type OperationPreviewStatus =
  'validating' | 'ready' | 'failed' | 'executing' | 'executed';

@Entity('operation_preview')
export class OperationPreview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  kind: string;

  @Column({ type: 'text' })
  status: OperationPreviewStatus;

  @Column({ type: 'text', name: 'original_filename' })
  originalFilename: string;

  @Column({ type: 'text', name: 'stored_path' })
  storedPath: string;

  @Column({ type: 'jsonb', nullable: true })
  report: Record<string, unknown> | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'uuid', name: 'import_job_id', nullable: true })
  importJobId: string | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
