import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({
    example: 'ABCD-2345',
    description: 'The invitation code (formatted or not) or the raw email-link token.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code!: string;
}
