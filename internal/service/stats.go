package service

import (
	"context"
	"time"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

type StatsService struct{ Store *postgres.Store }

// OverviewOptions bounds the two list-shaped sections of the overview payload.
type OverviewOptions struct {
	ReferrerLimit int
	RecentLimit   int
}

// Every aggregate below is narrowed to the caller's own links: an administrator
// has no restriction, a regular user only sees their own traffic. The scope is
// read from the session, so no handler has to pass it in.

func (s *StatsService) Summary(ctx context.Context) (domain.StatsSummary, error) {
	return s.Store.Summary(ctx, domain.OwnerIDFromContext(ctx))
}

func (s *StatsService) Daily(ctx context.Context, linkID string, from, to time.Time) ([]domain.DailyStat, error) {
	return s.Store.DailyStats(ctx, linkID, from, to)
}

// LinkStats gathers lifetime total, per-day series and referrer breakdown for
// one link in a single call. `to` is exclusive.
func (s *StatsService) LinkStats(ctx context.Context, linkID string, from, to time.Time, referrerLimit int) (domain.LinkStats, error) {
	total, err := s.Store.LinkTotalClicks(ctx, linkID)
	if err != nil {
		return domain.LinkStats{}, err
	}
	daily, err := s.Store.DailyStats(ctx, linkID, from, to)
	if err != nil {
		return domain.LinkStats{}, err
	}
	referrers, err := s.Store.LinkReferrers(ctx, linkID, from, to, referrerLimit)
	if err != nil {
		return domain.LinkStats{}, err
	}
	return domain.LinkStats{TotalClicks: total, Daily: daily, Referrers: referrers}, nil
}

// LinkClicks returns a page of the raw click log for one link. `to` is exclusive.
func (s *StatsService) LinkClicks(ctx context.Context, linkID string, from, to time.Time, limit, offset int) (domain.ClickPage, error) {
	clicks, total, err := s.Store.LinkClicks(ctx, linkID, from, to, limit, offset)
	if err != nil {
		return domain.ClickPage{}, err
	}
	return domain.ClickPage{Clicks: clicks, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *StatsService) Top(ctx context.Context, order string, limit int, from, to time.Time) ([]domain.LinkRank, error) {
	return s.Store.TopLinks(ctx, order, limit, from, to, domain.OwnerIDFromContext(ctx))
}

// Overview assembles the analytics dashboard payload. `to` is exclusive.
//
// TotalClicks is the sum of the trend series rather than a separate query, so
// the headline number always matches the chart underneath it.
func (s *StatsService) Overview(ctx context.Context, from, to time.Time, opts OverviewOptions) (domain.StatsOverview, error) {
	ownerID := domain.OwnerIDFromContext(ctx)
	summary, err := s.Store.Summary(ctx, ownerID)
	if err != nil {
		return domain.StatsOverview{}, err
	}
	trend, err := s.Store.GlobalTrend(ctx, from, to, ownerID)
	if err != nil {
		return domain.StatsOverview{}, err
	}
	var rangeClicks int64
	for _, point := range trend {
		rangeClicks += point.Clicks
	}
	visitors, err := s.Store.UniqueVisitors(ctx, from, to, ownerID)
	if err != nil {
		return domain.StatsOverview{}, err
	}
	referrers, err := s.Store.GlobalReferrers(ctx, from, to, opts.ReferrerLimit, ownerID)
	if err != nil {
		return domain.StatsOverview{}, err
	}
	devices, err := s.Store.DeviceBreakdown(ctx, from, to, ownerID)
	if err != nil {
		return domain.StatsOverview{}, err
	}
	recent, err := s.Store.RecentClicks(ctx, from, to, opts.RecentLimit, ownerID)
	if err != nil {
		return domain.StatsOverview{}, err
	}
	return domain.StatsOverview{
		TotalLinks:     summary.TotalLinks,
		TotalClicks:    rangeClicks,
		UniqueVisitors: visitors,
		Trend:          trend,
		Referrers:      referrers,
		Devices:        devices,
		RecentClicks:   recent,
	}, nil
}
