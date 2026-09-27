import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Set (or clear) the page a card's taps route to. Provide a `pageId` to point
 * the card at a Page (it goes ACTIVE), or pass `null`/omit it to unassign the
 * card (back to UNASSIGNED).
 */
export class SetDestinationDto {
  @ApiProperty({
    required: false,
    nullable: true,
    example: 'clx123abc',
    description: 'Target page id. Pass null or omit to clear the destination.',
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  pageId?: string | null;
}
