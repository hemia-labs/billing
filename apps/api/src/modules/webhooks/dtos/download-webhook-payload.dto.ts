import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class DownloadWebhookPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  reason: string;
}
