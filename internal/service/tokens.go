package service

import (
	"context"
	"errors"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
)

type TokenService struct{ Store *postgres.Store }

type CreatedToken struct {
	Token  domain.Token `json:"token"`
	Secret string       `json:"secret"`
}

func (t *TokenService) Create(ctx context.Context, userID, name string) (CreatedToken, error) {
	if name == "" || len(name) > 128 {
		return CreatedToken{}, errors.New("token name is required")
	}
	secret, err := security.RandomString(48)
	if err != nil {
		return CreatedToken{}, err
	}
	id := postgres.NewID()
	scopes := domain.DefaultTokenScopes
	if err := t.Store.CreateToken(ctx, id, userID, name, security.HashBytes(secret), secret[:8], scopes); err != nil {
		return CreatedToken{}, err
	}
	return CreatedToken{Token: domain.Token{ID: id, Name: name, Prefix: secret[:8], Scopes: scopes}, Secret: secret}, nil
}

func (t *TokenService) List(ctx context.Context, userID string) ([]domain.Token, error) {
	return t.Store.ListTokens(ctx, userID)
}
func (t *TokenService) Revoke(ctx context.Context, userID, id string) error {
	return t.Store.RevokeToken(ctx, userID, id)
}
