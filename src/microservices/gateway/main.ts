import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  listOrdersSchema,
  placeOrderSchema,
  type ListOrdersQuery,
  type PlaceOrderBody,
} from '../../shared/contract.js';
import { requireEnv } from '../../shared/db.js';

const ORDERS_URL = requireEnv('ORDERS_URL');
const INVENTORY_URL = requireEnv('INVENTORY_URL');

/** Forwards to an internal service and passes its status and body through. */
async function forward(res: Response, url: string, init?: RequestInit) {
  try {
    const upstream = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    res
      .status(upstream.status)
      .type('application/json')
      .send(await upstream.text());
  } catch {
    res.status(503).json({ statusCode: 503, message: 'Upstream service unavailable' });
  }
}

// The public edge: validates input, then routes. No business logic lives here.
@Controller()
class GatewayController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('products')
  products(@Res() res: Response) {
    return forward(res, `${INVENTORY_URL}/products`);
  }

  @Post('orders')
  place(
    @Body({ schema: placeOrderSchema }) body: PlaceOrderBody,
    @Headers('idempotency-key') key: string | undefined,
    @Res() res: Response,
  ) {
    return forward(res, `${ORDERS_URL}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(body),
    });
  }

  @Get('orders')
  list(
    @Query({ schema: listOrdersSchema }) _query: ListOrdersQuery,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return forward(res, `${ORDERS_URL}${req.url}`);
  }

  @Get('orders/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return forward(res, `${ORDERS_URL}/orders/${id}`);
  }

  @Post('orders/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return forward(res, `${ORDERS_URL}/orders/${id}/cancel`, { method: 'POST' });
  }
}

@Module({ controllers: [GatewayController] })
class GatewayModule {}

const app = await NestFactory.create(GatewayModule, { logger: ['error', 'warn', 'log'] });
app.useGlobalPipes(new StandardSchemaValidationPipe());
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 4100));
