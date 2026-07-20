import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmationModal from '../components/ConfirmationModal';

describe('ConfirmationModal', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Confirm Action',
    description: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    isDarkMode: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render when isOpen is true', () => {
    render(<ConfirmationModal {...defaultProps} />);
    
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
  });

  it('should not render when isOpen is false', () => {
    render(<ConfirmationModal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
  });

  it('should call onConfirm when confirm button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Confirm'));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when cancel button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when Escape key is pressed on the dialog', () => {
    render(<ConfirmationModal {...defaultProps} />);

    // The modal has no close/X button; Escape is the keyboard dismiss path
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when Escape key is pressed', () => {
    render(<ConfirmationModal {...defaultProps} />);
    
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('should display danger variant styles', () => {
    render(<ConfirmationModal {...defaultProps} variant="danger" confirmText="Delete" />);
    
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('should display warning variant styles', () => {
    render(<ConfirmationModal {...defaultProps} variant="warning" confirmText="Upgrade" />);
    
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
  });

  it('should display info variant styles', () => {
    render(<ConfirmationModal {...defaultProps} variant="info" confirmText="Continue" />);
    
    expect(screen.getByText('Continue')).toBeInTheDocument();
  });

  it('should not show cancel button when showCancel is false', () => {
    render(<ConfirmationModal {...defaultProps} showCancel={false} />);
    
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('should have correct aria attributes', () => {
    render(<ConfirmationModal {...defaultProps} />);
    
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Confirm Action')).toHaveAttribute('id', 'modal-title');
    expect(screen.getByText('Are you sure you want to proceed?')).toHaveAttribute('id', 'modal-description');
  });

  it('should use custom confirm and cancel text', () => {
    render(<ConfirmationModal 
      {...defaultProps} 
      confirmText="Yes, Do It"
      cancelText="No, Go Back"
    />);
    
    expect(screen.getByText('Yes, Do It')).toBeInTheDocument();
    expect(screen.getByText('No, Go Back')).toBeInTheDocument();
  });
});
