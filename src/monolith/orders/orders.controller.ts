import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  listOrdersSchema,
  placeOrderSchema,
  toView,
  type ListOrdersQuery,
  type PlaceOrderBody,
} from '../../shared/contract.js';
import { findOrder, listOrders } from '../../shared/orders-store.js';
import type { Pool } from '../../shared/db.js';
import { DB } from '../database.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    @Inject(DB) private readonly db: Pool,
  ) {}

  @Post()
  async place(
    @Body({ schema: placeOrderSchema }) body: PlaceOrderBody,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, created } = await this.orders.place(body, key);
    res.status(created ? 201 : 200);
    return toView(order);
  }

  @Get()
  async list(@Query({ schema: listOrdersSchema }) query: ListOrdersQuery) {
    return (await listOrders(this.db, query)).map(toView);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const order = await findOrder(this.db, id);
    if (!order) throw new NotFoundException('Order not found');
    return toView(order);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const order = await this.orders.cancel(id);
    if (order.status === 'CANCELLING') res.status(202);
    return toView(order);
  }
}
