import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Project } from '../projects/entities/project.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { User } from '../users/entities/user.entity';
import { Department } from '../departments/entities/department.entity';
import { PermissionService } from '../../common/services/permission.service';
import {
  ManufacturingCase, CustomerEquipment, TechnicalCompliance,
  ManufacturingReview, EngineeringChange, DeliveryMilestone,
} from './entities/manufacturing.entity';
import { ManufacturingService } from './manufacturing.service';
import { ManufacturingController } from './manufacturing.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    ManufacturingCase, CustomerEquipment, TechnicalCompliance, ManufacturingReview,
    EngineeringChange, DeliveryMilestone, Customer, Requirement, Project, Quotation, Contract, User, Department,
  ])],
  providers: [ManufacturingService, PermissionService],
  controllers: [ManufacturingController],
})
export class ManufacturingModule {}
