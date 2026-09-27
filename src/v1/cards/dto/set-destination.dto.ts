import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Set (or clear) where a card's taps go. Provide a `pageId` to point the card
 * at one of the company's pages, or a `url` to send taps straight to a custom
 * link (the card goes ACTIVE either way). Omit both, or pass null, to unassign
 * the card (back to UNASSIGNED). Never both at once.
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

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'https://instagram.com/yourbusiness',
    description:
      'Custom link instead of a page: https://, http://, tel:, mailto: or sms:.',
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  @Matches(
    /^(https?:\/\/[^\s]+|tel:[+\d\s()-]+|mailto:[^\s]+|sms:[+\d\s()-]+.*)$/i,
    {
      message: 'url must start with https://, http://, tel:, mailto: or sms:',
    },
  )
  url?: string | null;
}
