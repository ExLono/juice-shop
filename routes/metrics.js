/*
 * Copyright (c) 2014-2020 Bjoern Kimminich.
 * SPDX-License-Identifier: MIT
 */

const Prometheus = require('prom-client')
const onFinished = require('on-finished')
const orders = require('../data/mongodb').orders
const reviews = require('../data/mongodb').reviews
const challenges = require('../data/datacache').challenges
const utils = require('../lib/utils')
const config = require('config')
const models = require('../models')
const Op = models.Sequelize.Op

const register = Prometheus.register

exports.observeRequestMetricsMiddleware = function observeRequestMetricsMiddleware () {
  const httpRequestsMetric = new Prometheus.Counter({
    name: 'http_requests_count',
    help: 'Total HTTP request count grouped by status code.',
    labelNames: ['status_code']
  })

  return (req, res, next) => {
    onFinished(res, () => {
      const statusCode = `${Math.floor(res.statusCode / 100)}XX`
      httpRequestsMetric.labels(statusCode).inc()
    })

    next()
  }
}

exports.serveMetrics = function serveMetrics () {
  return (req, res, next) => {
    utils.solveIf(challenges.exposedMetricsChallenge, () => {
      const userAgent = req.headers['user-agent'] || ''
      return !userAgent.includes('Prometheus')
    })
    res.set('Content-Type', register.contentType)
    res.end(register.metrics())
  }
}

exports.observeMetrics = function observeMetrics () {
  const app = config.get('application.customMetricsPrefix')
  const intervalCollector = Prometheus.collectDefaultMetrics({ timeout: 5000 })
  register.setDefaultLabels({ app })

  const challengeSolvedMetrics = new Prometheus.Gauge({
    name: `${app}_challenges_solved`,
    help: 'Number of solved challenges grouped by difficulty.',
    labelNames: ['difficulty']
  })

  const challengeTotalMetrics = new Prometheus.Gauge({
    name: `${app}_challenges_total`,
    help: 'Total number of challenges grouped by difficulty.',
    labelNames: ['difficulty']
  })

  const orderMetrics = new Prometheus.Gauge({
    name: `${app}_orders_placed_total`,
    help: `Number of orders placed in ${config.get('application.name')}.`
  })

  const userMetrics = new Prometheus.Gauge({
    name: `${app}_users_registered`,
    help: 'Number of registered users grouped by customer type.',
    labelNames: ['type']
  })

  const userTotalMetrics = new Prometheus.Gauge({
    name: `${app}_users_registered_total`,
    help: 'Total number of registered users.'
  })

  const walletMetrics = new Prometheus.Gauge({
    name: `${app}_wallet_balance_total`,
    help: 'Total balance of all users\' digital wallets.'
  })

  const interactionsMetrics = new Prometheus.Gauge({
    name: `${app}_user_social_interactions`,
    help: 'Number of social interactions with users grouped by type.',
    labelNames: ['type']
  })

  const updateLoop = setInterval(() => {
    const challengeKeys = Object.keys(challenges)
    for (let difficulty = 1; difficulty <= 6; difficulty++) {
      challengeSolvedMetrics.set({ difficulty }, challengeKeys.filter((key) => (challenges[key].difficulty === difficulty && challenges[key].solved)).length)
      challengeTotalMetrics.set({ difficulty }, challengeKeys.filter((key) => (challenges[key].difficulty === difficulty)).length)
    }

    orders.count({}).then(orders => {
      orderMetrics.set(orders)
    })

    reviews.count({}).then(reviews => {
      interactionsMetrics.set({ type: 'review' }, reviews)
    })

    models.User.count({ where: { role: { [Op.eq]: ['customer'] } } }).then(count => {
      userMetrics.set({ type: 'standard' }, count)
    })
    models.User.count({ where: { role: { [Op.eq]: 'deluxe' } } }).then(count => {
      userMetrics.set({ type: 'deluxe' }, count)
    })
    models.User.count().then(count => {
      userTotalMetrics.set(count)
    })

    models.Wallet.sum('balance').then(totalBalance => {
      walletMetrics.set(totalBalance)
    })

    models.Feedback.count().then(count => {
      interactionsMetrics.set({ type: 'feedback' }, count)
    })

    models.Complaint.count().then(count => {
      interactionsMetrics.set({ type: 'complaint' }, count)
    })
  }, 5000)

  return {
    register: register,
    probe: intervalCollector,
    updateLoop: updateLoop
  }
}