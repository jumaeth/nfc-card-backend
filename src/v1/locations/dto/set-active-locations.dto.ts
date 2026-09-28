import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SetActiveLocationsDto {
  @ApiProperty({
    type: [String],
    description: 'Locations that stay editable. All others become read-only.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  locationIds!: string[];
}
